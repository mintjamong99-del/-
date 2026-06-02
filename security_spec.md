# Security Specification for Semarang Korean Church Firebase

## Data Invariants
1. Only the admin (`mintjamong99@gmail.com`) can create, update, or delete sermons, notices, events, pdf_bulletins, gallery, and settings.
2. Regular users can create and read prayers, and they can create registrations.
3. Prayers that are marked `isPrivate == true` can only be read by the creator or the admin (`mintjamong99@gmail.com`).
4. Timestamps (`createdAt`, `updatedAt`) must always match server request time on both creation and modification.
5. All document ID sizes must be <= 128 chars.
6. Fields must conform to strict schemas ensuring strings, numbers, or booleans to avoid data poisoning.

## The "Dirty Dozen" Malicious Payloads

### 1. Self-Assigned Admin State (Privilege Escalation)
Attempt to write to the `settings/staff` collection pretending to be an admin without being authenticated as `mintjamong99@gmail.com`.
- **Payload**: `{ "headPastor": "Malicious Actor", "updatedAt": "request.time" }`
- **Path**: `/settings/staff`
- **User**: `attacker@attacker.com`
- **Expected**: `PERMISSION_DENIED`

### 2. Bypass Terminals (Modifying Immutable CreatedAt)
Attempt to update a sermon's `createdAt` timestamp.
- **Payload**: `{ "createdAt": "2020-01-01T00:00:00Z" }` (immutable after creation)
- **Path**: `/sermons/sermon1`
- **User**: `mintjamong99@gmail.com`
- **Expected**: `PERMISSION_DENIED`

### 3. Read Private Prayers of Others
An authenticated member tries to get/list private prayers submitted by others.
- **Path**: `/prayers/private_prayer_1` where `isPrivate == true` and `authorId != callerId`
- **User**: `regular_user@gmail.com`
- **Expected**: `PERMISSION_DENIED`

### 4. Create Notice with Ghost Fields (Shadow Field Injection)
Attempt to inject an extra, un-validated field `extraSpecialAdminProp` into the `notices` collection.
- **Payload**: `{ "id": "not1", "title": "Attack", "content": "xyz", "date": "2026-06-01", "author": "Attacker", "category": "notice", "views": 0, "createdAt": "request.time", "extraSpecialAdminProp": "ghost" }`
- **Path**: `/notices/not1`
- **User**: `mintjamong99@gmail.com`
- **Expected**: `PERMISSION_DENIED` (hasOnly failed)

### 5. Infinite Views Increment Attack (Oversized string or malformed payload)
Attempt to write a huge 1MB string to the `views` field in a notice to exhaust database memory or cause an overflow.
- **Payload**: `{ "views": "not_a_number" }` or huge string.
- **Path**: `/notices/not1`
- **Expected**: `PERMISSION_DENIED`

### 6. Create Registration without Required fields
Attempt to create a registration omitting `phone`.
- **Payload**: `{ "id": "reg1", "name": "Hack", "dept": "Youth", "date": "2026-06-01", "createdAt": "request.time" }`
- **Path**: `/registrations/reg1`
- **Expected**: `PERMISSION_DENIED`

### 7. ID Poisoning (Junk characters as document ID)
Attempt to create a sermon with a document ID containing special characters or excessively long name.
- **Path**: `/sermons/../../../etc/passwd` or extremely long string.
- **Expected**: `PERMISSION_DENIED`

### 8. PII Blanket Read Attack
Attempt to retrieve all registrations (which contain names and phone numbers) as a regular user.
- **Path**: `/registrations`
- **User**: `regular_user@gmail.com`
- **Expected**: `PERMISSION_DENIED`

### 9. Self-Promotion on Prayers
An anonymous or regular user attempts to praise/like their own prayer multiple times bypass-style.
- **Payload**: `{ "praises": 9999999 }`
- **Path**: `/prayers/prayer1`
- **Expected**: `PERMISSION_DENIED`

### 10. Forged Client-Side Date
Attempt to write a sermon with `createdAt` set to a remote future client time instead of server time.
- **Payload**: `{ "createdAt": "2099-12-31T23:59:59Z" }`
- **Expected**: `PERMISSION_DENIED`

### 11. Read Notices without being Authenticated
All notices should be publicly readable, but can unregistered visitors read them? Yes, church notices should allow public read access for a welcoming church app. But writes must be secure.

### 12. Delete Setting Configuration
An unauthorized user attempts to delete the setting file.
- **Path**: `/settings/staff`
- **Expected**: `PERMISSION_DENIED`
