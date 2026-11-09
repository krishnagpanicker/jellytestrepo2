import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { apiFetch } from './apiClient';

WebBrowser.maybeCompleteAuthSession();
const SPOTIFY_CLIENT_ID = '3e17c3ad64224213a3db9ea91e92fd6a';
const REDIRECT_URI = 'jellytest://spotify-auth';

const discovery = {
    authorizationEndpoint: 'https://accounts.spotify.com/authorize',
    tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

const scopes = [
    'user-read-private',
    'user-read-playback-state',
    'user-read-currently-playing',
    'user-modify-playback-state',
];

export function useSpotifyAuth() {
    const [request, , promptAsync] = AuthSession.useAuthRequest({
        clientId: SPOTIFY_CLIENT_ID,
        redirectUri: REDIRECT_URI,
        responseType: AuthSession.ResponseType.Code,
        scopes,
        usePKCE: true,
    }, discovery);

    console.log("Spotify request exists:", !!request);
    console.log("Spotify authorization URL:", request?.url);
    console.log("Spotify redirect URI:", request?.redirectUri);
    console.log("Spotify code verifier exists:", !!request?.codeVerifier);

    async function connectSpotifyAccount() {
        console.log('Connect spotify account function entered.');
        if (!request || !request.codeVerifier) {
            throw new Error('Spotify authorization not ready.');
        }

        console.log('About to promptAsync.');

        let result;

        console.log("BEFORE promptAsync");

        try {
            result = await promptAsync({
                browserPackage: "com.android.chrome",
            });

            console.log("promptAsync RESOLVED:", result.type);
        } catch (error) {
            console.error("promptAsync REJECTED:", error);
            throw error;
        }

        console.log("AFTER promptAsync");

        if (result.type !== 'success') {
            if (result.type === 'error') {
                throw new Error(result.params.error_description ?? result.params.error ?? 'Spotify authorization failed.');
            }
            console.log(result);
            return false;
        }

        console.log('Spotify browser returned:', result);

        if (result.params.state !== request.state) {
            throw new Error('Spotify OAuth state mismatch.');
        }

        const code = result.params.code;

        if (!code) {
            throw new Error('Spotify did not return a code.');
        }

        const response = await apiFetch('/spotify/connect', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                code,
                codeVerifier: request.codeVerifier,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();

            throw new Error(`Spotify link failed: ${response.status} ${errorText}`);
        }

        return true;
    }

    return {
        connectSpotifyAccount,
        ready: !!request,
    };
}