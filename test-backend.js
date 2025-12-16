// test-backend.js - Test your backend
const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testBackend() {
    console.log('🧪 Testing MRTC eCampus Backend...\n');
    
    try {
        // Test 1: Health check
        console.log('1. Testing health check...');
        const health = await axios.get(`${BASE_URL}/api/health`);
        console.log('✅ Health:', health.data);
        
        // Test 2: Get courses
        console.log('\n2. Testing courses API...');
        const courses = await axios.get(`${BASE_URL}/api/courses`);
        console.log(`✅ Found ${courses.data.courses?.length || 0} courses`);
        
        if (courses.data.courses?.length > 0) {
            console.log('   First course:', courses.data.courses[0].title);
        }
        
        console.log('\n🎉 All backend tests passed!');
        console.log('\nNext steps:');
        console.log('1. Start frontend: Open index.html in browser');
        console.log('2. Login with admin account');
        console.log('3. Test enrollment and assessments');
        
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
        process.exit(1);
    }
}

testBackend();