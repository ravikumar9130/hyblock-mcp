import axios, { AxiosInstance } from "axios";

const BASE_URL = "https://api.hyblockcapital.com/v2";

interface TokenCache {
    accessToken: string;
    expiresAt: number; // Unix timestamp ms
}

let tokenCache: TokenCache | null = null;

/**
 * Fetch a fresh OAuth2 Bearer token using client credentials.
 */
async function fetchToken(
    clientId: string,
    clientSecret: string,
    apiKey: string
): Promise<string> {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const response = await axios.post(
        `${BASE_URL}/oauth2/token`,
        "grant_type=client_credentials",
        {
            headers: {
                Authorization: `Basic ${credentials}`,
                "Content-Type": "application/x-www-form-urlencoded",
                "x-api-key": apiKey,
            },
        }
    );

    const { access_token, expires_in } = response.data as {
        access_token: string;
        expires_in: number;
        token_type: string;
    };

    // Cache token, subtract 60 seconds for safety buffer
    tokenCache = {
        accessToken: access_token,
        expiresAt: Date.now() + (expires_in - 60) * 1000,
    };

    return access_token;
}

/**
 * Get a valid access token, fetching a new one if needed.
 */
export async function getToken(
    clientId: string,
    clientSecret: string,
    apiKey: string
): Promise<string> {
    if (tokenCache && Date.now() < tokenCache.expiresAt) {
        return tokenCache.accessToken;
    }
    return fetchToken(clientId, clientSecret, apiKey);
}

/**
 * Create an authenticated Axios instance for Hyblock API requests.
 */
export async function createApiClient(
    clientId: string,
    clientSecret: string,
    apiKey: string
): Promise<AxiosInstance> {
    const token = await getToken(clientId, clientSecret, apiKey);

    return axios.create({
        baseURL: BASE_URL,
        headers: {
            Authorization: `Bearer ${token}`,
            "x-api-key": apiKey,
        },
    });
}
