export interface getOAuthTokenResponse {
    access_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
}