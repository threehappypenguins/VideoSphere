# Appwrite: Tables API vs Databases API

This project uses **one** Appwrite database (`videosphere`) for all data. Appwrite exposes that database through two SDK surfaces with different names for the same concepts.

## Document-oriented, not relational

VideoSphere uses Appwrite as a **document-oriented** backend (collections of JSON documents), not as a relational/SQL database. The underlying storage model is the same as you’d get with a document store like MongoDB: flexible JSON per document, keyed by document ID. Our app code talks to that store via the **Tables API** (`TablesDB.createRow`, `getRow`, `listRows`, `updateRow`, etc.), not via a relational/SQL layer.

Both the setup script and the runtime code use the **Tables API**. Appwrite has moved schema and data operations to this “Tables” naming (table = collection, row = document, column = attribute), but under the hood you still have **collections of documents** in a document store. So the setup script was not created incorrectly—it uses Appwrite’s current recommended way to define schema and access data; it doesn’t change that you’re using a document-oriented database.

## Two names for the same thing

| Concept        | **Tables API** (what we use in app code + setup) | **Legacy Databases API** (deprecated) |
|----------------|---------------------------------------------------|---------------------------------------|
| Container      | **Table**                                         | **Collection**                        |
| One record     | **Row**                                           | **Document**                          |
| Field schema   | **Column**                                        | **Attribute**                         |

So when we say “the `user_profiles` **table**” in `lib/repositories/users.ts` or `scripts/setup-appwrite.ts`, we mean the same container and data. Same database, same storage.

## What we use where

- **App code** (repos, API routes): **Tables API** for data.  
  - `TablesDB` from `node-appwrite`: `getRow`, `createRow`, `listRows`, `updateRow`, etc.  
  - We use the same IDs as the setup script (e.g. `USER_PROFILES_COLLECTION_ID` = `user_profiles` table ID).  
  - The legacy **Databases API** (`createDocument`, `getDocument`, …) is deprecated in the SDK; we use Tables so the codebase stays on the supported API.

- **Setup script** (`scripts/setup-appwrite.ts`): **Tables API**  
  - `TablesDB` from `node-appwrite`: creates the database, **tables**, **columns**, and **indexes**.  
  - It uses the same IDs (e.g. `user_profiles` as table ID).

Indexes created by the setup script apply to the same data we query in the app. So the `user_profiles_email` index is what makes `Query.equal('email', ...)` work in `getUserByEmail`.

## Why Tables API everywhere?

Appwrite has deprecated the **Databases API** (both schema creation and data operations) in favor of the **Tables API**. The SDK marks `createDocument`, `getDocument`, `listDocuments`, `updateDocument`, etc. as deprecated since 1.8.0 and points to `TablesDB.createRow`, `getRow`, `listRows`, `updateRow`. So we use the Tables API for both the setup script and for data in the app (e.g. `lib/repositories/users.ts`). Same underlying document store; Tables is just the current, supported surface.

## Summary

- **Tables API** = the supported API (tables, rows, columns). We use it in the **setup script** (schema) and in **repos** (data).
- **Databases API** = deprecated (collections, documents). We no longer use it for data.
- You are **not** using a relational database. You’re using a document store; “table” and “row” are Appwrite’s current names for collection and document.
