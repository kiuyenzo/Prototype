-- Script to insert DID NF-A into Veramo database
-- Usage: sqlite3 database-nf-a.sqlite < insert-did-nf-a.sql

-- 1. Insert identifier with alias
INSERT INTO identifier (did, provider, alias, saveDate, updateDate)
VALUES (
  'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a',
  'did:web',
  'kiuyenzo.github.io:Prototype:cluster-a:did-nf-a',
  datetime('now'),
  datetime('now')
);

-- 2. Insert verification method key (EcdsaSecp256k1)
INSERT INTO key (kid, kms, type, publicKeyHex, meta, identifierDid)
VALUES (
  'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a#045e47622f68ac7869d7ba3f3ed4e929f3a2fa376328b4658de4895345f04d14748be846dc9291eff85693398eacddd9d82678f42cee8b7258f9b17c443fdac9e6',
  'local',
  'Secp256k1',
  '045e47622f68ac7869d7ba3f3ed4e929f3a2fa376328b4658de4895345f04d14748be846dc9291eff85693398eacddd9d82678f42cee8b7258f9b17c443fdac9e6',
  NULL,
  'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a'
);

-- 3. Insert keyAgreement key (X25519)
INSERT INTO key (kid, kms, type, publicKeyHex, meta, identifierDid)
VALUES (
  'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a#bfb6712c028fe03ac1488df7cba9a253fe3a1a5991541802a2a18d86fe2d8c3f',
  'local',
  'X25519',
  'bfb6712c028fe03ac1488df7cba9a253fe3a1a5991541802a2a18d86fe2d8c3f',
  NULL,
  'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a'
);

-- 4. Insert service
INSERT INTO service (id, type, serviceEndpoint, description, identifierDid)
VALUES (
  '#messaging',
  'DIDCommMessaging',
  'http://172.23.0.2:31829/messaging',
  '',
  'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a'
);
