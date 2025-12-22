npm -g i pnpm
pnpm install

npm init                    # Erstellt package.json
npm install @veramo/core    # Fügt Abhängigkeit hinzu


Zusammenfassung:
Datei	Erstellt von	Zweck
package.json	Du (npm init/install)	"Was brauche ich?"
package-lock.json	npm (automatisch)	"Welche exakten Versionen?"
node_modules/	npm install	Der tatsächliche Code


Nein! package.json ist essentiell.
Datei	Löschen?	Grund
package.json	❌ Niemals	Ohne sie weiß npm nicht was installiert werden soll
package-lock.json	⚠️ Möglich	Wird neu generiert
node_modules/	✅ Ja	Wird mit npm install neu erstellt

Based on our previous conversation, here's a summary of the npm packages you installed for your prototype: Production Dependencies:
Package	Purpose
@veramo/core	Veramo agent framework
@veramo/credential-w3c	W3C Verifiable Credentials
@veramo/data-store	SQLite data storage
@veramo/did-comm	DIDComm v2 messaging
@veramo/did-manager	DID management
@veramo/did-provider-web	did:web method
@veramo/did-resolver	DID resolution
@veramo/key-manager	Cryptographic key management
@veramo/kms-local	Local key storage
@veramo/message-handler	Message processing
@sphereon/pex	Presentation Exchange (VP requests/responses)
better-sqlite3	SQLite driver (fast, sync)
sqlite3	SQLite driver (async) - redundant
typeorm	Database ORM
did-resolver	DID resolution base
web-did-resolver	did:web resolution
Dev Dependencies:
Package	Purpose
@types/node	TypeScript types for Node.js
ts-node	Run TypeScript directly
typescript	TypeScript compiler
Note: You have both sqlite3 and better-sqlite3. Veramo uses better-sqlite3, so you could remove sqlite3 if you want to clean up:

npm uninstall sqlite3 # done