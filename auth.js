class MRTCFirebaseAuth {
    constructor() {
        this.auth = firebase.auth();
        this.googleProvider = new firebase.auth.GoogleAuthProvider();
        this.currentUser = null;
    }

    // Sign up with email/password
    async signUp(email, password, userData) {
        try {
            const userCredential = await this.auth.createUserWithEmailAndPassword(email, password);
            await this.saveUserData(userCredential.user.uid, {
                email,
                ...userData,
                role: 'student',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                profileCompleted: false,
                firstLogin: true
            });
            return { success: true, user: userCredential.user };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Google Sign In
    async signInWithGoogle() {
        try {
            const result = await this.auth.signInWithPopup(this.googleProvider);
            const user = result.user;
            
            // Check if user exists
            const userDoc = await db.collection('users').doc(user.uid).get();
            if (!userDoc.exists) {
                await this.saveUserData(user.uid, {
                    email: user.email,
                    displayName: user.displayName,
                    photoURL: user.photoURL,
                    role: 'student',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    profileCompleted: false,
                    firstLogin: true
                });
            }
            return { success: true, user };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Email/Password Sign In
    async signIn(email, password) {
        try {
            const userCredential = await this.auth.signInWithEmailAndPassword(email, password);
            return { success: true, user: userCredential.user };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Password Reset
    async resetPassword(email) {
        try {
            await this.auth.sendPasswordResetEmail(email);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Save user data to Firestore
    async saveUserData(uid, data) {
        try {
            await db.collection('users').doc(uid).set(data, { merge: true });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Get current user
    getCurrentUser() {
        return this.auth.currentUser;
    }

    // Sign out
    async signOut() {
        try {
            await this.auth.signOut();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Auth state listener
    onAuthStateChanged(callback) {
        return this.auth.onAuthStateChanged(callback);
    }
}

// Initialize and export
window.MRTCAuth = new MRTCFirebaseAuth();