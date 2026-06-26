# Security Specification - Cephboy AI GPT Chat

## 1. Data Invariants
- Conversations can be created, read, updated, and deleted without authentication (as this app is an offline/anonymous sandbox with no user login mechanism).
- Each conversation document MUST match its ID key (i.e., `incoming().id == conversationId`).
- Conversations MUST conform strictly to the required schema: `id` (string), `title` (string), `createdAt` (number), `updatedAt` (number), and `messages` (list).
- The `messages` array must not exceed 1000 items to prevent Denial of Wallet and size limit attacks.

## 2. The "Dirty Dozen" Payloads
These payloads attempt to bypass structure or inject malicious properties. All of them must return `PERMISSION_DENIED`:

1. **ID Spoofing**: Document ID in path is `chat_123` but payload contains `id: "chat_456"`.
2. **Missing Field (No title)**: Payload lacks `title` field.
3. **Missing Field (No messages)**: Payload lacks `messages` field.
4. **Invalid Type (Title is boolean)**: Title is set to `true` instead of a string.
5. **Invalid Type (createdAt is string)**: `createdAt` is a string instead of a number.
6. **Invalid Type (messages is object)**: `messages` is a map/object instead of an array.
7. **Ghost Field (Injection)**: Payload has all valid fields plus an unmapped field `isAdmin: true`.
8. **Malicious ID Length**: Path ID has size > 128 characters.
9. **Malicious Title Size**: Title has length > 250 characters.
10. **Corrupted Message Structure (role is not list elements format)**: List contains elements with invalid properties.
11. **Empty Keys**: Payload has an empty map.
12. **Array Overflow**: Payload attempts to store more than 1000 messages.

## 3. Test Runner (Conceptual)
Since we are deploying security rules directly to the Firebase Emulator/Live project sandbox, we ensure these rules are deployed and validated against our live requests.
