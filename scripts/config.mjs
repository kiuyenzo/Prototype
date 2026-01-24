export const CONFIG = {
  'nf-a': {
    db: './data/db-nf-a/database-nf-a.sqlite',
    key: 'ed9733675a04a20b91c5beb2196a6c964dce7d520a77be577a8a605911232ba6',
    did: 'did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a',
    cluster: 'cluster-a',
    enc: true
  },
  'nf-b': {
    db: './data/db-nf-b/database-nf-b.sqlite',
    key: '3859413b662c8fc7e632cda1fe9d5f07991c0b5d2bd2d8a69fa36e9e25cfef1d',
    did: 'did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b',
    cluster: 'cluster-b',
    enc: true
  },
  'issuer': {
    db: './data/db-issuer/database-issuer.sqlite',
    key: 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd',
    did: 'did:web:kiuyenzo.github.io:Prototype:dids:did-issuer',
    cluster: null,
    enc: false
  }
};

export const ISSUER = CONFIG['issuer'];
export const NFS = { 'nf-a': CONFIG['nf-a'], 'nf-b': CONFIG['nf-b'] };
