import 'dotenv/config';
import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import { db } from './db/index.js';
import { users, auth_accounts, refresh_tokens, spotify_accounts } from './db/schema.js';
import { eq, and, gt, lt, isNull, isNotNull, desc, asc, sql, inArray } from 'drizzle-orm';
import type { Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { createAccessToken, verifyAccessToken, createRefreshToken, hashRefreshToken } from './tokens.js';
import { exchangeSpotifyCode, encryptSpotifyToken, decryptSpotifyToken, refreshSpotifyAccessToken } from './services/spotify.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use(express.json());

const googleClient = new OAuth2Client(process.env.GOOGLE_WEB_CLIENT_ID!);

async function createAppSession(userId: string) {
    const accessToken = await createAccessToken(userId);
    const refreshToken = createRefreshToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await db.insert(refresh_tokens).values({
        user_id: userId,
        token_hash: hashRefreshToken(refreshToken),
        expires_at: expiresAt,
    });
    return { accessToken, refreshToken };
}

async function getSpotifyAccessToken(userId: string): Promise<string> {
    const [account] = await db.select().from(spotify_accounts).where(eq(spotify_accounts.id, userId)).limit(1);
    if (!account) {
        throw new Error('SPOTIFY_NOT_CONNECTED');
    }

    if (account.expires_at.getTime() > Date.now() + 60_000) {
        return decryptSpotifyToken(account.access_token);
    }

    const refreshToken = decryptSpotifyToken(account.refresh_token);

    const newTokens = await refreshSpotifyAccessToken(refreshToken);

    await db.update(spotify_accounts).set({
        access_token: encryptSpotifyToken(newTokens.access_token),
        refresh_token: newTokens.refresh_token ? encryptSpotifyToken(newTokens.refresh_token) : account.refresh_token,
        expires_at: new Date(Date.now() + newTokens.expires_in * 1000),
    }).where(eq(spotify_accounts.id, userId));

    return newTokens.access_token;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing access token.' });
    }

    const accessToken = authHeader.slice(7).trim();

    if (!accessToken || accessToken.split('.').length !== 3) {
        return res.status(401).json({
            error: 'Malformed access token. Expected a JWT with three dot-separated parts.',
        });
    }

    try {
        const userId = await verifyAccessToken(accessToken);
        req.user = {
            id: userId,
        };
        return next();
    } catch (error) {
        console.log(error);
        return res.status(401).json({ error: 'Invalid or expired access token.' });
    }
}

app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
    });
});

app.post("/auth/refresh", async (req, res) => {
    const { refreshToken } = req.body as {
        refreshToken?: string;
    };

    if (!refreshToken || typeof refreshToken !== "string") {
        return res.status(400).json({ error: "Missing refresh token." });
    }

    const oldTokenHash = hashRefreshToken(refreshToken);

    try {
        const matchingTokens = await db
        .select()
        .from(refresh_tokens)
        .where(
            and(
            eq(refresh_tokens.token_hash, oldTokenHash),
            gt(refresh_tokens.expires_at, new Date()),
            isNull(refresh_tokens.revoked_at)
            )
        )
        .limit(1);

        const oldToken = matchingTokens[0];

        if (!oldToken) {
        return res.status(401).json({ error: "Invalid refresh token." });
        }

        const userId = oldToken.user_id;

        const newAccessToken = await createAccessToken(userId);
        const newRefreshToken = createRefreshToken();

        const newExpiresAt = new Date();
        newExpiresAt.setDate(newExpiresAt.getDate() + 60);

        const insertedRefreshTokens = await db
            .insert(refresh_tokens)
            .values({
                user_id: userId,
                token_hash: hashRefreshToken(newRefreshToken),
                expires_at: newExpiresAt,
            })
            .returning();

        const newTokenRow = insertedRefreshTokens[0];

        await db
            .update(refresh_tokens)
            .set({
                revoked_at: new Date(),
                replaced_by: newTokenRow!.id,
            })
            .where(eq(refresh_tokens.id, oldToken.id));

        await db
            .delete(refresh_tokens)
            .where(and(eq(refresh_tokens.user_id, userId), isNotNull(refresh_tokens.revoked_at), isNotNull(refresh_tokens.replaced_by), lt(refresh_tokens.revoked_at, sql`now() - interval '1 day'`)));
        return res.status(200).json({
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Refresh failed." });
    }
});

app.post("/auth/logout", async (req, res) => {
    const { refreshToken } = req.body as {
        refreshToken?: string;
    };

    if (!refreshToken || typeof refreshToken !== "string") {
        return res.status(400).json({ error: "Missing refresh token." });
    }

    try {
        await db
            .update(refresh_tokens)
            .set({
                revoked_at: new Date(),
            })
            .where(eq(refresh_tokens.token_hash, hashRefreshToken(refreshToken)));

        return res.status(204).send();
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Logout failed." });
    }
});

app.delete("/auth/delete", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    try {
        const result = await db.delete(users).where(eq(users.id, userId)).returning();
        return res.status(200).json(result);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Account deletion failed.' });
    }
});

app.post("/auth/google", async (req, res) => {
    const { idToken } = req.body as { idToken?: string };
    if (!idToken || typeof idToken !== 'string') {
        return res.status(500).json({ error: 'Missing Google ID token aight?' });
    }

    try {
        const ticket = await googleClient.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_WEB_CLIENT_ID!,
        });
        const payload = ticket.getPayload();
        if (!payload?.sub) {
            return res.status(401).json({ error: 'Google token missing subject bro' });
        }
        const provider = 'google';
        const providerIssuer = 'https://accounts.google.com';
        const providerSubject = payload.sub;
        const email = payload.email ?? null;
        const emailVerified = payload.email_verified ?? null;
        const displayName = payload.name ?? null;
        const picture = payload.picture ?? null;

        const existingAuthAccounts = await db.select().from(auth_accounts).where(and(
            eq(auth_accounts.provider, provider),
            eq(auth_accounts.provider_issuer, providerIssuer),
            eq(auth_accounts.provider_subject, providerSubject),
        ));

        let userId: string;
        if (existingAuthAccounts[0]) {
            userId = existingAuthAccounts[0].user_id;
            const accessToken = await createAccessToken(userId);
            const refreshToken = createRefreshToken();
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 30);

            await db.insert(refresh_tokens).values({
                user_id: userId,
                token_hash: hashRefreshToken(refreshToken),
                expires_at: expiresAt,
            });
            return res.status(200).json({
                accessToken,
                refreshToken,
                user: {
                    id: userId,
                    email: existingAuthAccounts[0].email,
                    displayName: existingAuthAccounts[0].display_name,
                    picture: existingAuthAccounts[0].avatar_url,
                    existing: true,
                }
            });
        } else {
            const insertedUsers = await db.insert(users).values({
                email: email,
                name: displayName,
            }).returning();
            const newUser = insertedUsers[0];
            userId = newUser?.id!;
            await db.insert(auth_accounts).values({
                user_id: userId,
                provider: provider,
                provider_issuer: providerIssuer,
                provider_subject: providerSubject,
                email: email,
                email_verified: emailVerified,
                display_name: displayName,
                avatar_url: picture,
            });

            const accessToken = await createAccessToken(userId);
            const refreshToken = createRefreshToken();
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 30);

            await db.insert(refresh_tokens).values({
                user_id: userId,
                token_hash: hashRefreshToken(refreshToken),
                expires_at: expiresAt,
            });
            console.log('Access token:', accessToken);
            console.log('Refresh token:', refreshToken);
            return res.status(200).json({
                accessToken,
                refreshToken,
                user: {
                    id: userId,
                    email,
                    displayName,
                    picture,
                    existing: false,
                }
            });
        }
    } catch (error) {
        console.log(error);
        return res.status(500).json({ error: 'Google authentication failed lmao' });
    }
});

app.get("/me", requireAuth, async (req, res) => {
    try {
        const result = await db.select({
            id: users.id,
            email: users.email,
            name: users.name,
        }).from(users).where(eq(users.id, req.user!.id)).limit(1);
        const user = result[0];
        console.log("Me:", user);

        if (!user) {
            return res.status(404).json({ error: 'User(you) not found.' });
        }

        return res.status(200).json({
            id: user.id,
            email: user.email,
            name: user.name,
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ error: 'You have not been retrieved.' });
    }
});

app.post('/spotify/connect', requireAuth, async (req, res) => {
    const userId = req.user!.id;
    try {
        const { code, codeVerifier } = req.body ?? {};
        if (typeof code !== 'string' || !code || typeof codeVerifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
            return res.status(400).json({ error: 'Invalid Spotify authorization parameters.' });
        }

        const tokens = await exchangeSpotifyCode(code, codeVerifier);
        if (!tokens.refresh_token) {
            throw new Error('Spotify did not return a refresh token.');
        }

        const profileResponse = await fetch('https://api.spotify.com/v1/me', {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
            },
        });

        if (!profileResponse.ok) {
            throw new Error(`Spotify profile request failed: ${profileResponse.status}`);
        }

        const profile = await profileResponse.json() as {
            account_id?: string;
            display_name?: string | null;
        };

        if (!profile.account_id) {
            throw new Error('Spotify missing profile account ID.');
        }

        console.log('Spotify profile:', profile);

        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

        const encryptedAccessToken = encryptSpotifyToken(tokens.access_token);
        const encryptedRefreshToken = encryptSpotifyToken(tokens.refresh_token);

        await db.insert(spotify_accounts).values({
            id: userId,
            spotify_id: profile.account_id,
            name: profile.display_name ?? null,
            access_token: encryptedAccessToken,
            refresh_token: encryptedRefreshToken,
            expires_at: expiresAt,
        }).onConflictDoUpdate({
            target: spotify_accounts.id,
            set: {
                spotify_id: profile.account_id,
                name: profile.display_name ?? null,
                access_token: encryptedAccessToken,
                refresh_token: encryptedRefreshToken,
                expires_at: expiresAt,
            }
        });

        return res.status(200).json({
            connected: true,
            spotifyAccount: {
                id: profile.account_id,
                name: profile.display_name ?? null,
            },
        });
    } catch (error) {
        console.error('Spotify connection failed:', error);
        return res.status(500).json({ error: 'Unable to connect to Spotify account.' });
    }
});

app.get('/spotify/devices', requireAuth, async (req, res) => {
    const userId = req.user!.id;

    try {
        const spotifyAccessToken = await getSpotifyAccessToken(userId);
        const response = await fetch('https://api.spotify.com/v1/me/player/devices', {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${spotifyAccessToken}`,
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Spotify devices request failed:', response.status, errorText);
            return res.status(response.status).json({ error: 'Failed to retrieve Spotify devices.', spotifyStatus: response.status });
        }

        const data = await response.json() as {
            devices: Array<{
                id: string | null;
                name: string;
                type: string;
                is_active: boolean;
                is_restricted: boolean;
                volume_percent: number | null;
            }>;
        };

        console.log('Devices:', data.devices);

        return res.status(200).json({ devices: data.devices ?? [], });
    } catch (error) {
        console.error('Error retrieving Spotify devices:', error);

        if (error instanceof Error && error.message === 'SPOTIFY_NOT_CONNECTED') {
            return res.status(409).json({ error: 'Spotify account is not connected.' });
        }

        return res.status(500).json({ error: 'Unable to retrieve Spotify devices.' });
    }
});

app.put('/spotify/transfer', requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const { deviceId } = req.body ?? {};

    if (typeof deviceId !== 'string' || !deviceId.trim()) {
        return res.status(400).json({ error: 'A valid Spotify device ID is required.' });
    }

    try {
        const spotifyAccessToken = await getSpotifyAccessToken(userId);
        const devicesResponse = await fetch('https://api.spotify.com/v1/me/player/devices', {
            headers: {
                Authorization: `Bearer ${spotifyAccessToken}`,
            },
        });

        if (!devicesResponse.ok) {
            return res.status(502).json({ error: 'Unable to verify available Spotify devices.', spotifyStatus: devicesResponse.status });
        }

        const { devices } = await devicesResponse.json() as {
            devices: {
                id: string | null;
                is_active: boolean;
                is_restricted: boolean;
            }[];
        };

        const targetDevice = devices.find(
            (device) => device.id === deviceId
        );

        if (!targetDevice) {
            return res.status(404).json({
                error: 'Spotify device is no longer available. Refresh the list.',
            });
        }

        if (targetDevice.is_restricted) {
            return res.status(403).json({
                error: 'This Spotify device cannot be controlled through the API.',
            });
        }

        if (targetDevice.is_active) {
            return res.status(200).json({
                transferred: true,
                alreadyActive: true,
            });
        }

        const response = await fetch('https://api.spotify.com/v1/me/player', {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${spotifyAccessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                device_ids: [deviceId],
                play: false,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Spotify transfer error:', response.status, errorText);

            return res.status(response.status).json({
                error: 'Spotify could not transfer playback.',
                spotifyStatus: response.status,
            });
        }

        return res.status(200).json({
            transferred: true,
            deviceId,
        });
    } catch (error) {
        console.error('Spotify transfer failed:', error);
        if (error instanceof Error && error.message === 'SPOTIFY_NOT_CONNECTED') {
            return res.status(409).json({
                error: 'Spotify is not connected.',
            });
        }

        return res.status(500).json({
            error: 'Unable to transfer Spotify playback.',
        });
    }
})


/*
 * GET /spotify/playback
 *
 * Returns the user's current playback information.
 */
app.get("/spotify/playback", requireAuth, async (req, res) => {
    try {
        const accessToken = await getSpotifyAccessToken(req.user!.id);

        const response = await fetch(
            "https://api.spotify.com/v1/me/player",
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );

        // Spotify returns 204 when playback state is unavailable.
        if (response.status === 204) {
            return res.status(200).json({
                available: false,
                playback: null,
            });
        }

        if (!response.ok) {
            const details = await response.text();
            console.error("Spotify playback GET:", response.status, details);

            return res.status(response.status).json({
                error: "Could not retrieve Spotify playback.",
            });
        }

        const data = await response.json();

        return res.status(200).json({
            available: true,
            playback: data,
        });
    } catch (error) {
        console.error("Playback retrieval failed:", error);

        return res.status(500).json({
            error: "Unable to retrieve playback.",
        });
    }
});


/*
 * Shared helper for playback modification endpoints.
 *
 * This sends a request to Spotify and converts the
 * resulting HTTP status into a Jelly API response.
 */
async function sendSpotifyPlaybackCommand(
    userId: string,
    path: string,
    method: "PUT" | "POST",
    body?: object
): Promise<{ status: number; error?: string }> {
    const accessToken = await getSpotifyAccessToken(userId);

    const response = await fetch(
        `https://api.spotify.com/v1${path}`,
        {
            method,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                ...(body ? { "Content-Type": "application/json" } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        }
    );

    if (!response.ok) {
        const details = await response.text();

        console.error(
            "Spotify playback command failed:",
            response.status,
            details
        );

        return {
            status: response.status,
            error: "Spotify rejected the playback command.",
        };
    }

    return { status: response.status };
}


/*
 * PUT /spotify/playback/play
 *
 * Resumes the current Spotify playback.
 * Does not start a specific track if no context exists.
 */
app.put("/spotify/playback/play", requireAuth, async (req, res) => {
    try {
        const result = await sendSpotifyPlaybackCommand(
            req.user!.id,
            "/me/player/play",
            "PUT"
        );

        if (result.error) {
            return res.status(result.status).json({
                error: result.error,
            });
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            error: "Unable to resume Spotify playback.",
        });
    }
});


/*
 * PUT /spotify/playback/pause
 */
app.put("/spotify/playback/pause", requireAuth, async (req, res) => {
    try {
        const result = await sendSpotifyPlaybackCommand(
            req.user!.id,
            "/me/player/pause",
            "PUT"
        );

        if (result.error) {
            return res.status(result.status).json({
                error: result.error,
            });
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            error: "Unable to pause Spotify playback.",
        });
    }
});


/*
 * POST /spotify/playback/next
 */
app.post("/spotify/playback/next", requireAuth, async (req, res) => {
    try {
        const result = await sendSpotifyPlaybackCommand(
            req.user!.id,
            "/me/player/next",
            "POST"
        );

        if (result.error) {
            return res.status(result.status).json({
                error: result.error,
            });
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            error: "Unable to skip to next track.",
        });
    }
});


/*
 * POST /spotify/playback/previous
 */
app.post("/spotify/playback/previous", requireAuth, async (req, res) => {
    try {
        const result = await sendSpotifyPlaybackCommand(
            req.user!.id,
            "/me/player/previous",
            "POST"
        );

        if (result.error) {
            return res.status(result.status).json({
                error: result.error,
            });
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            error: "Unable to skip to previous track.",
        });
    }
});


/*
 * PUT /spotify/playback/seek
 *
 * Request body:
 * {
 *     "positionMs": 60000
 * }
 */
app.put("/spotify/playback/seek", requireAuth, async (req, res) => {
    const { positionMs } = req.body ?? {};

    if (
        typeof positionMs !== "number" ||
        !Number.isSafeInteger(positionMs) ||
        positionMs < 0
    ) {
        return res.status(400).json({
            error: "positionMs must be a non-negative integer.",
        });
    }

    try {
        const params = new URLSearchParams({
            position_ms: String(positionMs),
        });

        const result = await sendSpotifyPlaybackCommand(
            req.user!.id,
            `/me/player/seek?${params.toString()}`,
            "PUT"
        );

        if (result.error) {
            return res.status(result.status).json({
                error: result.error,
            });
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            error: "Unable to seek Spotify playback.",
        });
    }
});

app.get('/spotify/status', requireAuth, async (req, res) => {
    try {
        const [account] = await db.select({
            spotifyId: spotify_accounts.spotify_id,
            name: spotify_accounts.name,
        }).from(spotify_accounts).where(eq(spotify_accounts.id, req.user!.id)).limit(1);

        return res.status(200).json({ connected: !!account, account: account ?? null, });
    } catch (error) {
        console.error('Spotify status error:', error);
        return res.status(500).json({ error: 'Unable to check Spotify connection.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on PORT ${PORT}`);
});