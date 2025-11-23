// Test the Claude API endpoint with detailed error handling
const payload = {
  vehicle: "2020 Honda Civic",
  query: "brake pads",
  zipcode: "90210"
};

console.log('Testing Claude API endpoint...');
console.log('Payload:', JSON.stringify(payload, null, 2));

fetch('http://localhost:3000/api/grok-parts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
})
  .then(async res => {
    console.log('Response status:', res.status);
    const text = await res.text();
    console.log('Response content-type:', res.headers.get('content-type'));
    console.log('Response first 500 chars:', text.substring(0, 500));
    
    if (!res.ok) {
      console.error('Response not OK');
      return null;
    }
    
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error('JSON parse error:', e.message);
      return null;
    }
  })
  .then(data => {
    if (!data) return;
    
    console.log('\n✅ API Response received!');
    console.log('Response keys:', Object.keys(data));
    console.log('Results HTML length:', data.resultsHtml?.length || 0);
    console.log('Note text:', data.noteText);
    console.log('\nFirst 500 chars of HTML:');
    console.log(data.resultsHtml?.substring(0, 500) || 'No HTML');
  })
  .catch(err => {
    console.error('\n❌ API Error:', err.message);
  });
