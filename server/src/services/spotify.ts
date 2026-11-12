import crypto from 'crypto';
import 'dotenv/config';

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI!;

const encryptionKey = Buffer.from(
    process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY!,
    'base64url',
);

if (encryptionKey.length !== 32) {
    throw new Error('SPOTIFY_TOKEN_ENCRYPTION_KEY must decode to 32 bytes.');
}

type SpotifyTokenResponse = {
    access_token: string;
    refresh_token?: string;
    token_type: string;
    expires_in: number;
    scope: string;
};

export async function exchangeSpotifyCode(code: string, codeVerifier: string): Promise<SpotifyTokenResponse> {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: codeVerifier,
    });

    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Spotify token exchange failed (${response.status}): ${errorBody}`);
    }

    return (await response.json()) as SpotifyTokenResponse;
}

export function encryptSpotifyToken(token: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
        'aes-256-gcm',
        encryptionKey,
        iv
    );
    const encrypted = Buffer.concat([
        cipher.update(token, 'utf-8'),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([
        iv,
        authTag,
        encrypted,
    ]).toString('base64url');
}

export function decryptSpotifyToken(encryptedToken: string): string {
    const data = Buffer.from(encryptedToken, 'base64url');
    if (data.length < 29) {
        throw new Error('Invalid encrypted Spotify token.');
    }

    const iv = data.subarray(0, 12);
    const authTag = data.subarray(12, 28);
    const cipherText = data.subarray(28);

    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        encryptionKey,
        iv,
    );

    decipher.setAuthTag(authTag);
    
    return Buffer.concat([
        decipher.update(cipherText),
        decipher.final(),
    ]).toString('utf8');
}

export async function refreshSpotifyAccessToken(refreshToken: string) {
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.SPOTIFY_CLIENT_ID!,
    });

    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(`Spotify refresh failed: (${response.status}): ${message}`);
    }

    return await response.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        token_type: string;
    };
}