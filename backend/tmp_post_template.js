const http = require('http');
const data = JSON.stringify({
  name: 'Test Visual Template from Editor',
  content: '<div><h1>Test</h1></div>',
  type: 'Visual editor',
  category: 'N/A',
  createdBy: 'Mohammad Rabbani',
  createdDate: '2025-10-16T21:50:00Z',
  lastEdited: '2025-10-16T21:50:00Z',
  active: 'Yes',
  dragDrop: true,
  responsive: 'N/A',
  folderId: 'N/A',
  source: 'Visual Editor'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/templates',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OGUyOTUxYzFhMzY5NmNhZTAwOWQyYmEiLCJlbWFpbCI6InNoYWlrcmFiYmFuaTI5MTAyMDAwQGdtYWlsLmNvbSIsIm5hbWUiOiJNb2hhbW1hZCBSYWJiYW5pIiwiaWF0IjoxNzYwNzU0MTI3LCJleHAiOjE3NjA3NTc3Mjd9.LHoiiqfa2f24XGTWLq00P3jWkmlzi0D8GDD_ejFiYnE'
  }
};

const req = http.request(options, (res) => {
  let body = '';
  console.log('STATUS', res.statusCode);
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('BODY', body);
  });
});

req.on('error', (e) => console.error('ERR', e));
req.write(data);
req.end();
