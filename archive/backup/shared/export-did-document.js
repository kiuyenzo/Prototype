#!/usr/bin/env ts-node
"use strict";
/**
 * Export DID Document from Database
 *
 * This script exports the DID document with public keys from the database.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@veramo/core");
const key_manager_1 = require("@veramo/key-manager");
const did_manager_1 = require("@veramo/did-manager");
const data_store_1 = require("@veramo/data-store");
const kms_local_1 = require("@veramo/kms-local");
const did_provider_web_1 = require("@veramo/did-provider-web");
const did_resolver_1 = require("@veramo/did-resolver");
const did_resolver_2 = require("did-resolver");
const web_did_resolver_1 = require("web-did-resolver");
const typeorm_1 = require("typeorm");
const data_store_2 = require("@veramo/data-store");
const fs = __importStar(require("fs"));
// Configuration from environment
const DID = process.env.DID_NF_A || process.env.DID_NF_B || '';
const DB_PATH = process.env.DB_PATH || './database.sqlite';
const DB_ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY || '';
if (!DID) {
    console.error('❌ Error: DID environment variable not set (DID_NF_A or DID_NF_B)');
    process.exit(1);
}
if (!DB_ENCRYPTION_KEY) {
    console.error('❌ Error: DB_ENCRYPTION_KEY environment variable not set');
    process.exit(1);
}
// Determine output path
const isNFA = DID.includes('nf-a');
const OUTPUT_PATH = isNFA
    ? '/app/cluster-a/did-nf-a/did.json'
    : '/app/cluster-b/did-nf-b/did.json';
/**
 * Create a Veramo agent with database connection
 */
async function createAgentWithDatabase() {
    const dbConnection = new typeorm_1.DataSource({
        type: 'sqlite',
        database: DB_PATH,
        synchronize: false,
        migrationsRun: false,
        logging: false,
        entities: data_store_2.Entities,
    });
    await dbConnection.initialize();
    const agent = (0, core_1.createAgent)({
        plugins: [
            new key_manager_1.KeyManager({
                store: new data_store_1.KeyStore(dbConnection),
                kms: {
                    local: new kms_local_1.KeyManagementSystem(new data_store_1.PrivateKeyStore(dbConnection, new kms_local_1.SecretBox(DB_ENCRYPTION_KEY))),
                },
            }),
            new did_manager_1.DIDManager({
                store: new data_store_1.DIDStore(dbConnection),
                defaultProvider: 'did:web',
                providers: {
                    'did:web': new did_provider_web_1.WebDIDProvider({
                        defaultKms: 'local',
                    }),
                },
            }),
            new did_resolver_1.DIDResolverPlugin({
                resolver: new did_resolver_2.Resolver({
                    ...(0, web_did_resolver_1.getResolver)(),
                }),
            }),
            new data_store_1.DataStore(dbConnection),
            new data_store_1.DataStoreORM(dbConnection),
        ],
    });
    return { agent, dbConnection };
}
/**
 * Export DID document
 */
async function exportDIDDocument() {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📄 Exporting DID Document`);
    console.log('='.repeat(80));
    console.log(`\nDID:    ${DID}`);
    console.log(`DB:     ${DB_PATH}`);
    console.log(`Output: ${OUTPUT_PATH}`);
    try {
        const { agent, dbConnection } = await createAgentWithDatabase();
        console.log(`\n1. Finding DID in database...`);
        const identifiers = await agent.didManagerFind();
        const identifier = identifiers.find((id) => id.did.includes(isNFA ? 'nf-a' : 'nf-b'));
        if (!identifier) {
            console.error('   ❌ No identifier found');
            process.exit(1);
        }
        console.log(`   ✅ Found: ${identifier.did}`);
        console.log(`   Keys: ${identifier.keys.length}`);
        console.log(`\n2. Building DID Document...`);
        const didDocument = {
            '@context': [
                'https://www.w3.org/ns/did/v1',
                'https://w3id.org/security/suites/jws-2020/v1',
                'https://w3id.org/security/suites/x25519-2020/v1'
            ],
            id: DID,
            verificationMethod: [],
            authentication: [],
            assertionMethod: [],
            keyAgreement: [],
            service: []
        };
        // Add service endpoint
        const serviceEndpoint = isNFA
            ? 'http://172.23.0.2:32147'
            : 'http://172.23.0.3:31058';
        didDocument.service.push({
            id: `${DID}#didcomm-1`,
            type: 'DIDCommMessaging',
            serviceEndpoint
        });
        // Add keys
        for (const key of identifier.keys) {
            const keyId = `${DID}#${key.kid}`;
            if (key.type === 'Secp256k1') {
                didDocument.verificationMethod.push({
                    id: keyId,
                    type: 'EcdsaSecp256k1VerificationKey2019',
                    controller: DID,
                    publicKeyHex: key.publicKeyHex
                });
                didDocument.authentication.push(keyId);
                didDocument.assertionMethod.push(keyId);
                console.log(`   ✅ Added Secp256k1 key: ${key.kid.substring(0, 50)}...`);
            }
            else if (key.type === 'X25519') {
                didDocument.verificationMethod.push({
                    id: keyId,
                    type: 'X25519KeyAgreementKey2019',
                    controller: DID,
                    publicKeyHex: key.publicKeyHex
                });
                didDocument.keyAgreement.push(keyId);
                console.log(`   ✅ Added X25519 key: ${key.kid.substring(0, 50)}...`);
            }
        }
        // Add controller verification method
        didDocument.verificationMethod.push({
            id: `${DID}#controller`,
            type: 'EcdsaSecp256k1VerificationKey2019',
            controller: DID,
            publicKeyHex: identifier.keys[0].publicKeyHex
        });
        console.log(`\n3. Writing DID Document to ${OUTPUT_PATH}...`);
        const outputDir = OUTPUT_PATH.substring(0, OUTPUT_PATH.lastIndexOf('/'));
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(didDocument, null, 2));
        console.log(`   ✅ DID Document written`);
        console.log(`\n4. Verification:`);
        console.log(`   - Verification Methods: ${didDocument.verificationMethod.length}`);
        console.log(`   - Authentication: ${didDocument.authentication.length}`);
        console.log(`   - Assertion Method: ${didDocument.assertionMethod.length}`);
        console.log(`   - Key Agreement: ${didDocument.keyAgreement.length}`);
        console.log(`   - Services: ${didDocument.service.length}`);
        await dbConnection.destroy();
        console.log(`\n✅ DID Document exported successfully!`);
    }
    catch (error) {
        console.error(`\n❌ Error exporting DID document:`, error.message);
        console.error(error.stack);
        throw error;
    }
}
/**
 * Main function
 */
async function main() {
    console.log('='.repeat(80));
    console.log('📄 DID Document Exporter');
    console.log('='.repeat(80));
    try {
        await exportDIDDocument();
        console.log('\n' + '='.repeat(80));
        console.log('🎉 Export complete!');
        console.log('='.repeat(80));
    }
    catch (error) {
        console.error('\n❌ Failed to export DID document:', error.message);
        process.exit(1);
    }
}
// Run the script
main()
    .then(() => process.exit(0))
    .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
