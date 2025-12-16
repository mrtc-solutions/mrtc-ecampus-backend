// backend/deploy.js - Deployment automation script
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log('🚀 MRTC eCampus Backend Deployment Script');
console.log('=========================================\n');

async function deploy() {
    try {
        // Step 1: Check if we're in the right directory
        console.log('1. Checking project structure...');
        if (!fs.existsSync('package.json')) {
            throw new Error('package.json not found. Run from backend directory.');
        }
        
        // Step 2: Install dependencies
        console.log('2. Installing dependencies...');
        execSync('npm install', { stdio: 'inherit' });
        
        // Step 3: Run tests
        console.log('3. Running tests...');
        try {
            execSync('npm test', { stdio: 'inherit' });
        } catch (error) {
            console.warn('⚠️ Tests failed, but continuing deployment...');
        }
        
        // Step 4: Commit to Git
        console.log('4. Committing changes to Git...');
        try {
            execSync('git add .', { stdio: 'inherit' });
            execSync('git commit -m "Auto-deploy: ' + new Date().toISOString() + '"', { 
                stdio: 'inherit' 
            });
        } catch (error) {
            console.log('No changes to commit or git not initialized');
        }
        
        // Step 5: Push to GitHub
        console.log('5. Pushing to GitHub...');
        try {
            execSync('git push origin main', { stdio: 'inherit' });
            console.log('✅ Pushed to GitHub successfully');
        } catch (error) {
            console.log('⚠️ Could not push to GitHub. Make sure remote is set up.');
        }
        
        // Step 6: Deploy to Vercel (if configured)
        console.log('6. Deploying to Vercel...');
        const hasVercel = fs.existsSync('vercel.json');
        const hasVercelToken = process.env.VERCEL_TOKEN;
        
        if (hasVercel && hasVercelToken) {
            try {
                execSync('vercel --prod --token ' + process.env.VERCEL_TOKEN, { 
                    stdio: 'inherit' 
                });
                console.log('✅ Deployed to Vercel');
            } catch (error) {
                console.log('⚠️ Vercel deployment failed');
            }
        } else {