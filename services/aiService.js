const axios = require('axios');
const admin = require('firebase-admin');

class AIService {
    constructor() {
        this.db = admin.firestore();
        this.provider = process.env.PRIMARY_AI_PROVIDER || 'gemini';
    }

    // Rearrange assessment questions
    async rearrangeQuestions(questions, difficulty = 'medium') {
        try {
            const prompt = `
                You are rearranging assessment questions for an e-learning platform.
                Original questions: ${JSON.stringify(questions)}
                Difficulty level: ${difficulty}
                
                Please:
                1. Randomize the order of questions
                2. For each question, randomize the order of options
                3. Keep the correct answer mapping consistent
                4. Return JSON in this format:
                {
                    "questions": [
                        {
                            "id": "original_question_id",
                            "text": "question_text",
                            "options": ["option1", "option2", "option3", "option4"],
                            "correctAnswer": 0,
                            "explanation": "explanation_if_available"
                        }
                    ]
                }
            `;

            const rearrangedQuestions = await this.callAI(prompt, 'rearrange');
            
            // If AI fails, do basic randomization
            if (!rearrangedQuestions || rearrangedQuestions.error) {
                return this.basicQuestionRandomization(questions);
            }

            return rearrangedQuestions;
        } catch (error) {
            console.error('AI rearrangement error:', error);
            return this.basicQuestionRandomization(questions);
        }
    }

    // Basic randomization fallback
    basicQuestionRandomization(questions) {
        // Shuffle questions
        const shuffledQuestions = [...questions].sort(() => Math.random() - 0.5);
        
        // Shuffle options for each question
        return shuffledQuestions.map(question => {
            const options = [...question.options];
            const correctIndex = options.indexOf(question.correctAnswer);
            
            // Fisher-Yates shuffle
            for (let i = options.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [options[i], options[j]] = [options[j], options[i]];
            }
            
            // Update correct answer index
            const newCorrectIndex = options.indexOf(question.correctAnswer);
            
            return {
                ...question,
                options: options,
                correctAnswer: newCorrectIndex
            };
        });
    }

    // Generate personalized feedback
    async generateAssessmentFeedback(score, weakAreas) {
        const prompt = `
            Student scored ${score}% on assessment.
            Weak areas: ${JSON.stringify(weakAreas)}
            
            Provide:
            1. Encouraging feedback
            2. Specific improvement suggestions
            3. Recommended review topics
            4. Motivational message
            
            Format as JSON: {
                "feedback": "main_feedback_text",
                "suggestions": ["suggestion1", "suggestion2"],
                "reviewTopics": ["topic1", "topic2"],
                "motivation": "motivational_message"
            }
        `;

        return await this.callAI(prompt, 'feedback');
    }

    // Call Gemini API
    async callGemini(prompt, taskType) {
        try {
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
                {
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 2000,
                    }
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            const text = response.data.candidates[0].content.parts[0].text;
            
            // Extract JSON from response
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            
            return { text: text };
        } catch (error) {
            console.error('Gemini API error:', error.response?.data || error.message);
            throw error;
        }
    }

    // Call DeepSeek API
    async callDeepSeek(prompt, taskType) {
        try {
            const response = await axios.post(
                'https://api.deepseek.com/v1/chat/completions',
                {
                    model: 'deepseek-chat',
                    messages: [{
                        role: 'user',
                        content: prompt
                    }],
                    temperature: 0.7,
                    max_tokens: 2000
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const text = response.data.choices[0].message.content;
            
            // Extract JSON from response
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            
            return { text: text };
        } catch (error) {
            console.error('DeepSeek API error:', error.response?.data || error.message);
            throw error;
        }
    }

    // Generic AI call
    async callAI(prompt, taskType) {
        try {
            if (this.provider === 'gemini') {
                return await this.callGemini(prompt, taskType);
            } else if (this.provider === 'deepseek') {
                return await this.callDeepSeek(prompt, taskType);
            }
        } catch (error) {
            console.error(`AI call failed with ${this.provider}:`, error);
            // Fallback to basic logic
            return { error: 'AI service unavailable', fallback: true };
        }
    }
}

module.exports = new AIService();