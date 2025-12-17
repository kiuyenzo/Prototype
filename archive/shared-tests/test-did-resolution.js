import { Resolver } from 'did-resolver';
import { getResolver as webDidResolver } from 'web-did-resolver';

const resolver = new Resolver({
  ...webDidResolver()
});

async function testResolution() {
  console.log('Testing DID Resolution...\n');

  const dids = [
    'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a',
    'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b'
  ];

  for (const did of dids) {
    console.log(`Resolving: ${did}`);
    try {
      const result = await resolver.resolve(did);
      if (result.didDocument) {
        console.log('✅ Success!');
        console.log(`   ID: ${result.didDocument.id}`);
        const vmCount = result.didDocument.verificationMethod ? result.didDocument.verificationMethod.length : 0;
        console.log(`   Verification Methods: ${vmCount}`);
      } else {
        console.log('❌ Failed: No DID document');
        console.log('   Error:', JSON.stringify(result.didResolutionMetadata, null, 2));
      }
    } catch (error) {
      console.log('❌ Error:', error.message);
    }
    console.log('');
  }
}

testResolution();
