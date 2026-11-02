import * as SecureStore from "expo-secure-store";

const API_BASE_URL = "http://10.0.2.2:3000";
// Android emulator talking to backend on your computer: 10.0.2.2
// iOS simulator: http://localhost:4000
// physical phone: http://YOUR_COMPUTER_LAN_IP:4000

async function refreshSession(): Promise<string> {
    const refreshToken = await SecureStore.getItemAsync("refreshToken");

    if (!refreshToken) {
        throw new Error("No refresh token.");
    }

    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: {
        "Content-Type": "application/json",
        },
        body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
        await SecureStore.deleteItemAsync("accessToken");
        throw new Error("Session expired.");
    }

    const data = await response.json();
    console.log("Backend /auth/google response:", data);

    await SecureStore.setItemAsync("accessToken", data.accessToken);
    await SecureStore.setItemAsync("refreshToken", data.refreshToken);

    return data.accessToken;
}

export async function apiFetch(
    path: string,
    options: RequestInit = {}
): Promise<Response> {
    let accessToken = await SecureStore.getItemAsync("accessToken");
    const refreshToken = await SecureStore.getItemAsync("refreshToken");

    if (!path.startsWith('/api/listTotal') && !path.startsWith('/api/listCount')) {
        console.log("apiFetch path:", path);
        console.log("Has access token:", Boolean(accessToken));
        console.log("Has refresh token:", Boolean(refreshToken));
    }

    let response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: {
            ...(options.headers ?? {}),
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
    });

    if (!path.startsWith('/api/listTotal') && !path.startsWith('/api/listCount')) {
        console.log("Initial response status:", response.status);
    }

    if (response.status !== 401) {
        return response;
    }

    console.log("Got 401. Attempting refresh...");

    accessToken = await refreshSession();

    response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: {
            ...(options.headers ?? {}),
            Authorization: `Bearer ${accessToken}`,
        },
    });

    console.log("Retry response status:", response.status);

    return response;
}

export async function publicApiFetch(
    path: string,
    options: RequestInit = {},
): Promise<Response> {
    return fetch (`${API_BASE_URL}${path}`, options);
}

export async function saveSession(accessToken: string, refreshToken: string) {
    console.log("ACCESS TOKEN:", accessToken)
    await SecureStore.setItemAsync("accessToken", accessToken);
    console.log("REFRESH TOKEN:", refreshToken);
    await SecureStore.setItemAsync("refreshToken", refreshToken);
}

export async function clearSession() {
    await SecureStore.deleteItemAsync("accessToken");
    await SecureStore.deleteItemAsync("refreshToken");
}

export async function getStoredRefreshToken() {
    return SecureStore.getItemAsync("refreshToken");
}