import { View, Text } from 'react-native';

export default function SpotifyAuthCallback() {
    return (
        <View
            style={{
                flex: 1,
                backgroundColor: '#10141D',
                justifyContent: 'center',
                alignItems: 'center',
            }}
        >
            <Text style={{ color: 'white' }}>Completing Spotify connection...</Text>
        </View>
    )
}