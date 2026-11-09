export function redirectSystemPath({
    path,
}: {
    path: string;
    initial: boolean;
}): string | null {
    if (
        path.includes("spotify-auth") &&
        path.includes("code=")
    ) {
        return null;
    }

    return path;
}