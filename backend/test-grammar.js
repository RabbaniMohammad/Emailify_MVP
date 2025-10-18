// Test the grammar check endpoint
const testHTML = `
<html>
<body>
  <h1>This are a test</h1>
  <p>I has the the book.</p>
  <p>chat gpt is amazing!</p>
  <p>He don't know about this.</p>
  <p>We seen it yesterday.</p>
</body>
</html>
`;

async function testGrammarCheck() {
  try {
    console.log('\n🔍 Testing Grammar Check Endpoint...\n');
    
    const response = await fetch('http://localhost:3000/api/grammar-check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ html: testHTML }),
    });

    if (!response.ok) {
      console.error('❌ HTTP Error:', response.status, response.statusText);
      const text = await response.text();
      console.error('Response:', text);
      return;
    }

    const result = await response.json();
    console.log('🌟 ============ GRAMMAR CHECK RESULTS ============\n');
    console.log('📊 Stats:');
    console.log(`   Total: ${result.stats.total}`);
    console.log(`   Applied: ${result.stats.applied}`);
    console.log(`   Failed: ${result.stats.failed}`);
    
    if (result.appliedEdits && result.appliedEdits.length > 0) {
      console.log('\n✅ Applied Corrections:');
      result.appliedEdits.forEach((edit, i) => {
        console.log(`\n   ${i + 1}. "${edit.find}" → "${edit.replace}"`);
        console.log(`      Reason: ${edit.reason}`);
      });
    }
    
    if (result.failedEdits && result.failedEdits.length > 0) {
      console.log('\n❌ Failed Corrections:');
      result.failedEdits.forEach((edit, i) => {
        console.log(`\n   ${i + 1}. "${edit.find}" → "${edit.replace}"`);
        console.log(`      Reason: ${edit.reason}`);
        console.log(`      Error: ${edit.error}`);
      });
    }
    
    console.log('\n================================================\n');
    console.log('✅ Test completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error during test:', error.message);
    console.error('Make sure backend server is running on http://localhost:3000');
  }
}

testGrammarCheck();
