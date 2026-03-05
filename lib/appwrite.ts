// =============================================================================
// APPWRITE SERVER-SIDE CLIENT
// =============================================================================
// Initializes a server-side Appwrite client for use in API routes.
// Uses the admin API key for secure operations on the server.
//
// NOTE: This should ONLY be used on the server. Never expose APPWRITE_API_KEY to the client.
// =============================================================================

import { Client, Account, Users } from 'node-appwrite';

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;

if (!endpoint || !projectId || !apiKey) {
  throw new Error(
    'Missing required Appwrite configuration. Check .env.local for NEXT_PUBLIC_APPWRITE_ENDPOINT, NEXT_PUBLIC_APPWRITE_PROJECT_ID, and APPWRITE_API_KEY'
  );
}

// Server-side client (with admin API key)
const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);

export const appwriteAuth = new Account(client);
export const appwriteUsers = new Users(client);

export default client;
