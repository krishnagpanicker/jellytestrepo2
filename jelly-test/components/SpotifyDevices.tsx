
import React, { useCallback, useEffect, useState } from "react";
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
    StyleSheet,
} from "react-native";

import { apiFetch } from "@/lib/apiClient";

type SpotifyDevice = {
    id: string | null;
    name: string;
    type: string;
    is_active: boolean;
    is_restricted: boolean;
    volume_percent: number | null;
};

type Props = {
    connected: boolean;
};

export default function SpotifyDevices({ connected }: Props) {
    const [devices, setDevices] = useState<SpotifyDevice[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [transferringId, setTransferringId] = useState<string | null>(null);

    const refreshDevices = useCallback(async () => {
        if (!connected) return;

        setLoading(true);
        setError(null);

        try {
            const response = await apiFetch("/spotify/devices");

            if (!response.ok) {
                const body = await response.text();
                throw new Error(
                    `Failed to retrieve devices (${response.status}): ${body}`
                );
            }

            const data = await response.json();

            setDevices(data.devices ?? []);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }, [connected]);


    async function transferPlayback(device: SpotifyDevice) {
        if (!device.id || device.is_restricted || device.is_active) {
            return;
        }

        if (transferringId !== null) {
            return;
        }

        setTransferringId(device.id);
        setError(null);

        try {
            const response = await apiFetch("/spotify/transfer", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    deviceId: device.id,
                }),
            });

            if (!response.ok) {
                const data = await response.json().catch(() => null);

                throw new Error(
                    data?.error ??
                    `Spotify transfer failed (${response.status})`
                );
            }

            // Spotify accepted the request.
            // Refresh to obtain the actual active device state.
            await refreshDevices();

        } catch (error) {
            setError(
                error instanceof Error
                    ? error.message
                    : "Unable to transfer playback."
            );
        } finally {
            setTransferringId(null);
        }
    }

    useEffect(() => {
        if (connected) {
            refreshDevices();
        } else {
            setDevices([]);
            setError(null);
        }
    }, [connected, refreshDevices]);

    if (!connected) {
        return null;
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View>
                    <Text style={styles.title}>
                        Spotify Devices
                    </Text>
                    <Text style={styles.subtitle}>
                        Available playback devices
                    </Text>
                </View>

                <TouchableOpacity
                    onPress={refreshDevices}
                    disabled={loading}
                    style={styles.refreshButton}
                >
                    <Text style={styles.refreshText}>
                        Refresh
                    </Text>
                </TouchableOpacity>
            </View>

            {loading && (
                <ActivityIndicator
                    color="#1DB954"
                    style={{ marginVertical: 20 }}
                />
            )}

            {error && !loading && (
                <View style={styles.messageBox}>
                    <Text style={styles.errorText}>
                        {error}
                    </Text>
                </View>
            )}

            {!loading && !error && devices.length === 0 && (
                <View style={styles.messageBox}>
                    <Text style={styles.emptyTitle}>
                        No Spotify devices found
                    </Text>

                    <Text style={styles.emptyDescription}>
                        Open Spotify on your phone, computer,
                        or another device to get started.
                        Then tap Refresh.
                    </Text>
                </View>
            )}

            {!loading && !error && devices.length > 0 && (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.deviceList}
                >
                    
                {devices.map((device, index) => {
                    const isTransferring = transferringId === device.id;
                    const canTransfer =
                        !!device.id &&
                        !device.is_restricted &&
                        !device.is_active &&
                        transferringId === null;

                    return (
                        <TouchableOpacity
                            key={`${device.id ?? device.name}-${index}`}
                            style={[
                                styles.deviceCard,
                                device.is_active && styles.activeCard,
                                device.is_restricted && styles.restrictedCard,
                            ]}
                            onPress={() => transferPlayback(device)}
                            disabled={!canTransfer || loading}
                            activeOpacity={0.7}
                        >
                            <Text style={styles.deviceIcon}>
                                {device.type.toLowerCase() === "computer" ? "💻" :
                                device.type.toLowerCase() === "smartphone" ? "📱" :
                                device.type.toLowerCase() === "speaker" ? "🔊" :
                                "🎵"}
                            </Text>

                            <Text
                                style={styles.deviceName}
                                numberOfLines={1}
                            >
                                {device.name}
                            </Text>

                            <Text style={styles.deviceType}>
                                {device.type}
                            </Text>

                            {isTransferring ? (
                                <ActivityIndicator color="#1DB954" />
                            ) : (
                                <Text
                                    style={[
                                        styles.deviceStatus,
                                        device.is_active && styles.activeStatus,
                                    ]}
                                >
                                    {device.is_restricted
                                        ? "Restricted"
                                        : device.is_active
                                        ? "● Active"
                                        : "Available"}
                                </Text>
                            )}

                            <Text style={styles.volume}>
                                Volume: {
                                    device.volume_percent === null
                                        ? "Unavailable"
                                        : `${device.volume_percent}%`
                                }
                            </Text>

                            <View
                                style={[
                                    styles.transferIndicator,
                                    device.is_active &&
                                        styles.transferIndicatorActive,
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.transferText,
                                        device.is_active &&
                                            styles.transferTextActive,
                                    ]}
                                >
                                    {isTransferring
                                        ? "Transferring..."
                                        : device.is_restricted
                                        ? "Unavailable"
                                        : device.is_active
                                            ? "Currently selected"
                                            : "Transfer here"}
                                </Text>
                            </View>
                        </TouchableOpacity>
                    );
                })}

                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginTop: 16,
        padding: 16,
        backgroundColor: "#1E2532",
        borderRadius: 14,
        gap: 14,
    },
    header: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    title: {
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
        borderWidth: 1,
        borderColor: "#566074",
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    refreshText: {
        color: "#FFFFFF",
        fontWeight: "600",
    },
    deviceList: {
        gap: 12,
        paddingRight: 8,
    },
    deviceCard: {
        width: 160,
        minHeight: 170,
        borderRadius: 12,
        backgroundColor: "#10141D",
        borderWidth: 1,
        borderColor: "#303747",
        padding: 14,
        gap: 8,
    },
    activeCard: {
        borderColor: "#1DB954",
    },
    deviceIcon: {
        fontSize: 26,
    },
    deviceName: {
        color: "#FFFFFF",
        fontWeight: "700",
        fontSize: 15,
    },
    deviceType: {
        color: "#A7B0C2",
        fontSize: 12,
    },
    deviceStatus: {
        color: "#A7B0C2",
        fontSize: 12,
        fontWeight: "600",
    },
    activeStatus: {
        color: "#65DDA1",
    },
    volume: {
        color: "#9AA6B8",
        fontSize: 12,
    },
    messageBox: {
        paddingVertical: 20,
        paddingHorizontal: 12,
        alignItems: "center",
        gap: 10,
    },
    emptyTitle: {
        color: "#FFFFFF",
        fontWeight: "700",
        fontSize: 16,
    },
    emptyDescription: {
        color: "#A7B0C2",
        textAlign: "center",
        lineHeight: 21,
    },
    errorText: {
        color: "#FF8A8A",
        textAlign: "center",
    },
    restrictedCard: {
        opacity: 0.5,
    },

    transferIndicator: {
        marginTop: 8,
        paddingVertical: 9,
        paddingHorizontal: 6,
        borderRadius: 8,
        backgroundColor: "#303747",
        alignItems: "center",
    },

    transferIndicatorActive: {
        backgroundColor: "#163D2B",
    },

    transferText: {
        color: "#FFFFFF",
        fontSize: 11,
        fontWeight: "600",
        textAlign: "center",
    },

    transferTextActive: {
        color: "#65DDA1",
    },
});
