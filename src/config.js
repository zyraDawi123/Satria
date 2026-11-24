// Set these values after creating your Google Cloud OAuth client and Google Sheet.
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
export const GOOGLE_SHEET_ID = import.meta.env.VITE_GOOGLE_SHEET_ID || "";
export const GOOGLE_SHEET_RANGE = import.meta.env.VITE_GOOGLE_SHEET_RANGE || "Sheet1!A1:F";
export const GOOGLE_SCOPES = "openid email profile https://www.googleapis.com/auth/spreadsheets.readonly";
