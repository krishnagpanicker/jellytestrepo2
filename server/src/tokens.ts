import crypto from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import dotenv from 'dotenv';

dotenv.config();

const accessTokenSecretText = process.env.ACCESS_TOKEN_SECRET!;
const accessTokenSecret = new TextEncoder().encode(accessTokenSecretText);

const issuer = process.env.ACCESS_TOKEN_ISSUER!;
const audience = process.env.ACCESS_TOKEN_AUDIENCE!;

export async function createAccessToken(userId: string): Promise<string> {
    return new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime("2m")
        .sign(accessTokenSecret);
}

export async function verifyAccessToken(accessToken: string): Promise<string> {
    const { payload } = await jwtVerify(accessToken, accessTokenSecret, {
        issuer,
        audience,
    });

    if (!payload.sub || typeof payload.sub !== 'string') {
        throw new Error('Access token subject error haha');
    }

    return payload.sub;
}

export function createRefreshToken(): string {
    return crypto.randomBytes(32).toString("base64url");
}

export function hashRefreshToken(refreshToken: string): string {
    return crypto.createHash("sha256").update(refreshToken).digest("hex");
}