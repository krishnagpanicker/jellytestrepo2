import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { GoogleSignin } from '../../lib/googleAuth';
import { saveSession, apiFetch, clearSession, getStoredRefreshToken } from '@/lib/apiClient';

type Stage = 'google' | 'spotify' | 'tester';

type AuthUser = {
    id: string;
    email: string | null;
    name: string | null;
};

const API_BASE_URL = 'http://10.0.2.2:3000';

async function loginWithGoogle() {
    console.log('Google login function.');
    await GoogleSignin.hasPlayServices();
    const result = await GoogleSignin.signIn();
    console.log('Google sign-in result:', JSON.stringify(result, null, 2));
    const idToken = 'data' in result ? result.data?.idToken : (result as unknown as { idToken?: string }).idToken;
    if (!idToken) {
        throw new Error('Google sign-in did not return an ID token.');
    }

    const response = await fetch(`${API_BASE_URL}/auth/google`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ idToken }),
    });

    if (!response.ok) {
        const errorText = await response.text();

        console.log('Backend Google login status:', response.status);
        console.log('Backend Google login body:', errorText);

        throw new Error(`Backend Google login failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    await saveSession(data.accessToken, data.refreshToken);
    console.log(data.user);
    return data;
}

async function getMe(): Promise<AuthUser> {
    const response = await apiFetch('/me');
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch current user: ${response.status} ${errorText}`);
    }

    const { id, email, name } = await response.json();
    console.log("ME:", id, name)
    return {
        id,
        email,
        name,
    };
}

export async function bootstrapSession() {
    console.log('Bootstrapping.');
    const refreshToken = await getStoredRefreshToken();

    if (!refreshToken) {
        return null;
    }

    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
        await clearSession();
        return null;
    }

    const data = await response.json();
    await saveSession(data.accessToken, data.refreshToken);
    return getMe();
}

async function logout() {
    const refreshToken = await getStoredRefreshToken();
    if (refreshToken) {
        await fetch(`${API_BASE_URL}/auth/logout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ refreshToken })
        }).catch(() => {

        })
    }

    await clearSession();

    try {
        await GoogleSignin.signOut();
    } catch (error) {
        console.log(error);
    }
}

export default function HomeScreen() {
    const [stage, setStage] = useState<Stage>('google');
    const [loading, setLoading] = useState(false);
    const [response, setResponse] = useState('');
    const [initializing, setInitializing] = useState(true);
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [user, setUser] = useState<AuthUser | null>();

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const currentUser = await bootstrapSession();
                if (active && currentUser) {
                    setUser(currentUser);
                    setStage('spotify');
                }
            } catch (error) {
                
            } finally {
                if (active) setInitializing(false);
            }
        })();
        return () => { active = false; };
    }, []);

    // TODO: Replace with actual Google authentication.
    async function connectGoogle() {
        setLoading(true);

        try {
            const data = await loginWithGoogle();
            console.log(data);
            setUser(data.user);
            setStage('spotify');
            setResponse('');
        } catch (error) {
            Alert.alert('Google authentication failed', String(error));
        } finally {
            setLoading(false);
        }
    }

    async function handleLogout() {
        setLoading(true);
        try {
            await logout();
            setUser(null);
            setStage('google');
            setResponse('');
        } catch (error) {
            Alert.alert('Logout error:', String(error));
        } finally {
            setLoading(false);
        }
    }

    // TODO: Replace with actual Spotify OAuth.
    async function connectSpotify() {
        setLoading(true);

        try {
            // 1. Request Spotify authorization URL from backend
            // 2. Open authorization URL in browser
            // 3. Handle OAuth callback
            // 4. Backend exchanges authorization code for tokens
            // 5. Confirm Spotify account is connected

            setStage('tester');
        } catch (error) {
            Alert.alert('Spotify connection failed', String(error));
        } finally {
            setLoading(false);
        }
    }

    async function testEndpoint(
        name: string,
        path: string,
        method: 'GET' | 'PUT' | 'POST' = 'GET'
    ) {
        setLoading(true);
        setResponse("");

        try {
        const result = await fetch(`${API_BASE_URL}${path}`, {
            method,
            headers: {
            "Content-Type": "application/json",
            ...(accessToken
                ? { Authorization: `Bearer ${accessToken}` }
                : {}),
            },
        });

        const text = await result.text();

        let data: unknown;

        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = text;
        }

        setResponse(
            JSON.stringify(
            {
                endpoint: name,
                status: result.status,
                data,
            },
            null,
            2
            )
        );
        } catch (error) {
        setResponse(`Request failed:\n${String(error)}`);
        } finally {
        setLoading(false);
        }
    }

    function reset() {
        setStage('google');
        setAccessToken(null);
        setResponse('');
    }

    return (
        <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        >
        <Text style={styles.logo}>♫ Jelly</Text>
        <Text style={styles.subtitle}>Host Integration Tester</Text>

        {user && (
            <View style={styles.accountCard}>
                <View style={styles.accountTop}>
                <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{(user.name || user.email || 'U').charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.accountInfo}>
                    <Text style={styles.connected}>✓ Google account connected</Text>
                    <Text style={styles.accountName}>{user.name || 'Jelly user'}</Text>
                    <Text style={styles.accountEmail}>{user.email || 'No email available'}</Text>
                </View>
                </View>
                <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} disabled={loading}>
                <Text style={styles.logoutText}>Log out</Text>
                </TouchableOpacity>
            </View>
        )}

        <View style={styles.progress}>
            <View style={styles.progressActive} />

            <View
            style={
                stage !== 'google'
                ? styles.progressActive
                : styles.progressInactive
            }
            />

            <View
            style={
                stage === 'tester'
                ? styles.progressActive
                : styles.progressInactive
            }
            />
        </View>

        {stage === 'google' && (
            <View style={styles.section}>
            <Text style={styles.heading}>Welcome to Jelly</Text>

            <Text style={styles.description}>
                Sign in with Google to authenticate your host account.
            </Text>

            <TouchableOpacity
                style={styles.googleButton}
                onPress={connectGoogle}
                disabled={loading}
            >
                <Text style={styles.googleButtonText}>
                Continue with Google
                </Text>
            </TouchableOpacity>
            </View>
        )}

        {stage === 'spotify' && (
            <View style={styles.section}>
            <Text style={styles.success}>
                ✓ Google connected (demo)
            </Text>

            <Text style={styles.heading}>Connect Spotify</Text>

            <Text style={styles.description}>
                Authorize Jelly to access your Spotify account,
                playback information, and queue.
            </Text>

            <TouchableOpacity
                style={styles.spotifyButton}
                onPress={connectSpotify}
                disabled={loading}
            >
                <Text style={styles.spotifyButtonText}>
                Connect Spotify
                </Text>
            </TouchableOpacity>
            </View>
        )}

        {stage === 'tester' && (
            <View style={styles.section}>
            <Text style={styles.success}>
                ✓ Google connected (demo)
            </Text>

            <Text style={styles.success}>
                ✓ Spotify connected (demo)
            </Text>

            <Text style={styles.heading}>Spotify API Tester</Text>

            <Text style={styles.description}>
                Run requests against your Jelly backend.
            </Text>

            <ApiButton
                title='Get Spotify Queue'
                onPress={() =>
                testEndpoint('Get Queue', '/spotify/queue')
                }
            />

            <ApiButton
                title='Get Current Playback'
                onPress={() =>
                testEndpoint('Current Playback', '/spotify/player')
                }
            />

            <ApiButton
                title='Get Spotify Profile'
                onPress={() =>
                testEndpoint('Spotify Profile', '/spotify/me')
                }
            />

            <ApiButton
                title='Pause Playback'
                onPress={() =>
                testEndpoint(
                    'Pause Playback',
                    '/spotify/pause',
                    'PUT'
                )
                }
            />

            <ApiButton
                title='Refresh Connection Status'
                onPress={() =>
                testEndpoint(
                    'Connection Status',
                    '/spotify/status'
                )
                }
            />

            <TouchableOpacity
                style={styles.resetButton}
                onPress={reset}
            >
                <Text style={styles.resetText}>
                Reset Test Flow
                </Text>
            </TouchableOpacity>
            </View>
        )}

        {loading && (
            <ActivityIndicator
            size='large'
            color='#1DB954'
            style={{ marginTop: 24 }}
            />
        )}

        {response !== '' && (
            <View style={styles.responseBox}>
            <Text style={styles.responseTitle}>
                API Response
            </Text>

            <Text selectable style={styles.responseText}>
                {response}
            </Text>
            </View>
        )}
        </ScrollView>
    );
}

function ApiButton({
    title,
    onPress,
    }: {
    title: string;
    onPress: () => void;
    }) {
    return (
        <TouchableOpacity
        style={styles.apiButton}
        onPress={onPress}
        >
        <Text style={styles.apiButtonText}>
            {title}
        </Text>

        <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#10141D",
    },
    content: {
        padding: 24,
        paddingTop: 70,
        paddingBottom: 60,
    },
    logo: {
        color: "#FFFFFF",
        fontSize: 34,
        fontWeight: "800",
    },
    subtitle: {
        color: "#9AA6B8",
        marginTop: 5,
        fontSize: 14,
    },
    progress: {
        flexDirection: "row",
        gap: 8,
        marginTop: 32,
        marginBottom: 36,
    },
    progressActive: {
        flex: 1,
        height: 5,
        borderRadius: 5,
        backgroundColor: "#1DB954",
    },
    progressInactive: {
        flex: 1,
        height: 5,
        borderRadius: 5,
        backgroundColor: "#303747",
    },
    section: {
        gap: 16,
    },
    heading: {
        color: "#FFFFFF",
        fontSize: 26,
        fontWeight: "700",
    },
    description: {
        color: "#A7B0C2",
        fontSize: 15,
        lineHeight: 23,
        marginBottom: 12,
    },
    success: {
        color: "#65DDA1",
        fontSize: 14,
        marginBottom: 6,
    },
    googleButton: {
        backgroundColor: "#FFFFFF",
        padding: 17,
        borderRadius: 12,
        alignItems: "center",
    },
    googleButtonText: {
        color: "#161616",
        fontSize: 16,
        fontWeight: "700",
    },
    spotifyButton: {
        backgroundColor: "#1DB954",
        padding: 17,
        borderRadius: 12,
        alignItems: "center",
    },
    spotifyButtonText: {
        color: "#101410",
        fontSize: 16,
        fontWeight: "700",
    },
    apiButton: {
        backgroundColor: "#1E2532",
        borderRadius: 12,
        padding: 18,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    apiButtonText: {
        color: "#FFFFFF",
        fontSize: 15,
        fontWeight: "600",
    },
    arrow: {
        color: "#A7B0C2",
        fontSize: 24,
    },
    resetButton: {
        borderColor: "#566074",
        borderWidth: 1,
        borderRadius: 12,
        padding: 15,
        alignItems: "center",
        marginTop: 12,
    },
    resetText: {
        color: "#FFFFFF",
        fontWeight: "600",
    },
    responseBox: {
        backgroundColor: "#090D14",
        borderRadius: 12,
        padding: 16,
        marginTop: 28,
    },
    responseTitle: {
        color: "#FFFFFF",
        fontSize: 16,
        fontWeight: "700",
        marginBottom: 12,
    },
    responseText: {
        color: "#A7E3BA",
        fontSize: 12,
        lineHeight: 19,
        fontFamily: "monospace",
    },
    accountCard: { marginTop: 25, borderRadius: 14, backgroundColor: '#1E2532', padding: 16, gap: 14 },
    accountTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#364C40', alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#B7F5C9', fontSize: 24, fontWeight: '700' },
    accountInfo: { flex: 1 },
    connected: { color: '#65DDA1', fontSize: 12, fontWeight: '600', marginBottom: 3 },
    accountName: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
    accountEmail: { color: '#A7B0C2', fontSize: 13, marginTop: 3 },
    logoutButton: { borderWidth: 1, borderColor: '#566074', borderRadius: 9, padding: 11, alignItems: 'center' },
    logoutText: { color: '#FFFFFF', fontWeight: '600' },
});