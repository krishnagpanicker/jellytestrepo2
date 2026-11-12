
import React, {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import {
    View,
    Text,
    Image,
    TouchableOpacity,
    ActivityIndicator,
    StyleSheet,
    AppState,
} from "react-native";

import Slider from "@react-native-community/slider";
import { apiFetch } from "@/lib/apiClient";

type SpotifyItem = {
    id?: string;
    type: string;
    name: string;
    duration_ms: number;
    artists?: { name: string }[];
    album?: {
        name: string;
        images: { url: string }[];
    };
    images?: { url: string }[];
    show?: { name: string };
};

type PlaybackState = {
    is_playing: boolean;
    progress_ms: number | null;
    currently_playing_type: string;
    item: SpotifyItem | null;
    device: {
        id: string | null;
        name: string;
        is_restricted: boolean;
    } | null;
    actions?: {
        disallows?: {
            pausing?: boolean;
            resuming?: boolean;
            seeking?: boolean;
            skipping_next?: boolean;
            skipping_prev?: boolean;
        };
    };
};

type PlaybackResponse = {
    available: boolean;
    playback: PlaybackState | null;
};

type Props = {
    connected: boolean;
};

function formatTime(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);

    const minutesPart = Math.floor(seconds / 60);
    const secondsPart = seconds % 60;

    return `${minutesPart}:${String(secondsPart).padStart(2, "0")}`;
}

export default function SpotifyPlayback({ connected }: Props) {
    const [playback, setPlayback] =
        useState<PlaybackState | null>(null);

    const [progress, setProgress] = useState(0);
    const [dragging, setDragging] = useState(false);

    const [loading, setLoading] = useState(false);
    const [commandLoading, setCommandLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const commandInProgress = useRef(false);
    const fetching = useRef(false);
    const mounted = useRef(true);
    const active = useRef(true);
    const draggingRef = useRef(false);

    const refreshPlayback = useCallback(async () => {
        if (!connected || fetching.current || commandInProgress.current) {
            return;
        }

        fetching.current = true;

        try {
            const response = await apiFetch("/spotify/playback");

            if (!response.ok) {
                const body = await response.text();

                throw new Error(
                    `Playback request failed (${response.status}): ${body}`
                );
            }

            const data =
                (await response.json()) as PlaybackResponse;

            if (!mounted.current) return;

            setPlayback(data.available ? data.playback : null);

            if (!draggingRef.current) {
                setProgress(data.playback?.progress_ms ?? 0);
            }

            setError(null);
        } catch (err) {
            if (mounted.current) {
                setError(
                    err instanceof Error ? err.message : String(err)
                );
            }
        } finally {
            fetching.current = false;
            if (mounted.current) setLoading(false);
        }
    }, [connected]);

    // Load playback state and periodically synchronize with Spotify.
    useEffect(() => {
        mounted.current = true;
        active.current = AppState.currentState === "active";

        if (!connected) {
            setPlayback(null);
            setProgress(0);
            setError(null);
            return;
        }

        setLoading(true);
        refreshPlayback();

        const refreshInterval = setInterval(() => {
            if (active.current) refreshPlayback();
        }, 10000);

        const subscription = AppState.addEventListener(
            "change",
            (state) => {
                const wasActive = active.current;
                active.current = state === "active";

                if (active.current && !wasActive) {
                    refreshPlayback();
                }
            }
        );

        return () => {
            mounted.current = false;
            clearInterval(refreshInterval);
            subscription.remove();
        };
    }, [connected, refreshPlayback]);

    // Locally advance the progress bar once per second.
    // This does not make any Spotify API requests.
    useEffect(() => {
        if (!playback?.is_playing || !playback.item) return;

        const interval = setInterval(() => {
            if (
                active.current &&
                !draggingRef.current &&
                !commandInProgress.current
            ) {
                setProgress((previous) =>
                    Math.min(
                        previous + 1000,
                        playback.item?.duration_ms ?? previous
                    )
                );
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [playback?.is_playing, playback?.item?.id]);

    async function sendCommand(
        path: string,
        method: "PUT" | "POST",
        body?: object
    ) {
        if (commandInProgress.current) return false;

        commandInProgress.current = true;
        setCommandLoading(true);
        setError(null);

        try {
            const response = await apiFetch(path, {
                method,
                ...(body
                    ? {
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify(body),
                    }
                    : {}),
            });

            if (!response.ok) {
                const data = await response.json().catch(() => null);

                throw new Error(
                    data?.error ??
                    `Playback command failed (${response.status})`
                );
            }

            return true;
        } catch (err) {
            setError(
                err instanceof Error ? err.message : String(err)
            );
            return false;
        } finally {
            commandInProgress.current = false;
            setCommandLoading(false);
        }
    }

    async function executeCommand(
        path: string,
        method: "PUT" | "POST"
    ) {
        const succeeded = await sendCommand(path, method);

        if (succeeded) {
            await refreshPlayback();
        }
    }

    async function seekTo(value: number) {
        draggingRef.current = false;
        setDragging(false);

        if (!playback?.item) return;

        const positionMs = Math.round(
            Math.max(0, Math.min(value, playback.item.duration_ms))
        );

        setProgress(positionMs);

        const succeeded = await sendCommand(
            "/spotify/playback/seek",
            "PUT",
            { positionMs }
        );

        if (succeeded) {
            await refreshPlayback();
        }
    }

    if (!connected) return null;

    const item = playback?.item;
    const duration = item?.duration_ms ?? 0;
    const artwork =
        item?.album?.images?.[0]?.url ??
        item?.images?.[0]?.url;

    const artist =
        item?.artists?.map((a) => a.name).join(", ") ??
        item?.show?.name ??
        "Unknown artist";

    const restricted = playback?.device?.is_restricted ?? false;
    const disallows = playback?.actions?.disallows;

    const controlsDisabled =
        commandLoading || loading || restricted || !item;

    const canSeek =
        !controlsDisabled &&
        !disallows?.seeking &&
        duration > 0;

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View>
                    <Text style={styles.heading}>Now Playing</Text>
                    <Text style={styles.subtitle}>
                        Spotify playback controls
                    </Text>
                </View>

                <TouchableOpacity
                    style={styles.refreshButton}
                    onPress={() => {
                        setLoading(true);
                        refreshPlayback();
                    }}
                    disabled={commandLoading}
                >
                    <Text style={styles.refreshText}>Refresh</Text>
                </TouchableOpacity>
            </View>

            {loading && !playback && (
                <ActivityIndicator color="#1DB954" />
            )}

            {!playback && !loading && !error && (
                <View style={styles.emptyBox}>
                    <Text style={styles.emptyTitle}>
                        No active Spotify playback
                    </Text>

                    <Text style={styles.emptyDescription}>
                        Open Spotify on a device and start a song
                        to use Jelly's playback controls.
                    </Text>
                </View>
            )}

            {playback && !item && (
                <View style={styles.emptyBox}>
                    <Text style={styles.emptyTitle}>
                        No track selected
                    </Text>

                    <Text style={styles.emptyDescription}>
                        Select and play a song in Spotify first.
                    </Text>
                </View>
            )}

            {playback && item && (
                <>
                    <View style={styles.trackRow}>
                        {artwork ? (
                            <Image
                                source={{ uri: artwork }}
                                style={styles.artwork}
                            />
                        ) : (
                            <View style={styles.artworkPlaceholder}>
                                <Text style={{ fontSize: 30 }}>♫</Text>
                            </View>
                        )}

                        <View style={styles.trackInfo}>
                            <Text style={styles.deviceName}>
                                {playback.device?.name ?? "Spotify"}
                            </Text>

                            <Text
                                style={styles.trackTitle}
                                numberOfLines={2}
                            >
                                {item.name}
                            </Text>

                            <Text
                                style={styles.artist}
                                numberOfLines={2}
                            >
                                {artist}
                            </Text>

                            {!!item.album?.name && (
                                <Text
                                    style={styles.album}
                                    numberOfLines={1}
                                >
                                    {item.album.name}
                                </Text>
                            )}
                        </View>
                    </View>

                    <View style={styles.progressSection}>
                        <Slider
                            minimumValue={0}
                            maximumValue={Math.max(duration, 1)}
                            step={1000}
                            value={Math.min(progress, Math.max(duration, 1))}
                            minimumTrackTintColor="#1DB954"
                            maximumTrackTintColor="#455065"
                            thumbTintColor="#1DB954"
                            disabled={!canSeek}
                            onSlidingStart={() => {
                                draggingRef.current = true;
                                setDragging(true);
                            }}
                            onValueChange={(value) => {
                                setProgress(value);
                            }}
                            onSlidingComplete={seekTo}
                        />

                        <View style={styles.timeRow}>
                            <Text style={styles.time}>
                                {formatTime(progress)}
                            </Text>
                            <Text style={styles.time}>
                                {formatTime(duration)}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.controls}>
                        <TouchableOpacity
                            disabled={
                                controlsDisabled ||
                                !!disallows?.skipping_prev
                            }
                            onPress={() =>
                                executeCommand(
                                    "/spotify/playback/previous",
                                    "POST"
                                )
                            }
                            style={styles.skipButton}
                        >
                            <Text style={styles.skipText}>⏮</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.playButton,
                                controlsDisabled && styles.disabled,
                            ]}
                            disabled={
                                controlsDisabled ||
                                (playback.is_playing
                                    ? !!disallows?.pausing
                                    : !!disallows?.resuming)
                            }
                            onPress={() =>
                                executeCommand(
                                    playback.is_playing
                                        ? "/spotify/playback/pause"
                                        : "/spotify/playback/play",
                                    "PUT"
                                )
                            }
                        >
                            {commandLoading ? (
                                <ActivityIndicator color="#10141D" />
                            ) : (
                                <Text style={styles.playText}>
                                    {playback.is_playing ? "Ⅱ" : "▶"}
                                </Text>
                            )}
                        </TouchableOpacity>

                        <TouchableOpacity
                            disabled={
                                controlsDisabled ||
                                !!disallows?.skipping_next
                            }
                            onPress={() =>
                                executeCommand(
                                    "/spotify/playback/next",
                                    "POST"
                                )
                            }
                            style={styles.skipButton}
                        >
                            <Text style={styles.skipText}>⏭</Text>
                        </TouchableOpacity>
                    </View>

                    <Text style={styles.status}>
                        {restricted
                            ? "Playback controls restricted on this device"
                            : playback.is_playing
                              ? "● Playing"
                              : "Ⅱ Paused"}
                    </Text>
                </>
            )}

            {error && (
                <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{error}</Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginTop: 16,
        padding: 16,
        borderRadius: 14,
        backgroundColor: "#1E2532",
        gap: 16,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    heading: {
        color: "#FFFFFF",
        fontSize: 18,
        fontWeight: "700",
    },
    subtitle: {
        color: "#9AA6B8",
        fontSize: 12,
        marginTop: 4,
    },
    refreshButton: {
        borderColor: "#566074",
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    refreshText: {
        color: "#FFFFFF",
        fontWeight: "600",
    },
    trackRow: {
        flexDirection: "row",
        gap: 14,
        alignItems: "center",
    },
    artwork: {
        width: 110,
        height: 110,
        borderRadius: 10,
    },
    artworkPlaceholder: {
        width: 110,
        height: 110,
        backgroundColor: "#10141D",
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    trackInfo: {
        flex: 1,
        gap: 5,
    },
    deviceName: {
        color: "#65DDA1",
        fontSize: 12,
        fontWeight: "600",
    },
    trackTitle: {
        color: "#FFFFFF",
        fontSize: 17,
        fontWeight: "700",
    },
    artist: {
        color: "#A7B0C2",
        fontSize: 13,
    },
    album: {
        color: "#9AA6B8",
        fontSize: 11,
    },
    progressSection: {
        gap: 2,
    },
    timeRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        paddingHorizontal: 4,
    },
    time: {
        color: "#A7B0C2",
        fontSize: 12,
        fontVariant: ["tabular-nums"],
    },
    controls: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
    },
    skipButton: {
        padding: 10,
    },
    skipText: {
        color: "#FFFFFF",
        fontSize: 30,
    },
    playButton: {
        backgroundColor: "#1DB954",
        width: 62,
        height: 62,
        borderRadius: 31,
        alignItems: "center",
        justifyContent: "center",
    },
    playText: {
        color: "#10141D",
        fontSize: 26,
        fontWeight: "800",
    },
    disabled: {
        opacity: 0.5,
    },
    status: {
        color: "#65DDA1",
        fontSize: 12,
        textAlign: "center",
    },
    emptyBox: {
        paddingVertical: 24,
        gap: 12,
        alignItems: "center",
    },
    emptyTitle: {
        color: "#FFFFFF",
        fontSize: 16,
        fontWeight: "700",
    },
    emptyDescription: {
        color: "#A7B0C2",
        textAlign: "center",
        lineHeight: 21,
    },
    errorBox: {
        backgroundColor: "#40242A",
        borderRadius: 8,
        padding: 12,
    },
    errorText: {
        color: "#FF9B9B",
        fontSize: 12,
    },
});
