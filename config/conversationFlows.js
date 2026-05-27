// ============================================
// FILE: config/conversationFlows.js
// ============================================
/**
 * Define different conversation flows
 * This is configurable and reusable
 */

const conversationFlows = {
    // Login/Registration Flow
    login: {
      name: 'Login Flow',
      initialPrompt: {
        text: 'Welcome! 👋 Would you like to proceed with login to access all features?',
        buttons: [
          { id: 'login_yes', title: '✅ Yes, Login' },
          { id: 'login_no', title: '❌ No, Later' }
        ]
      },
      positiveResponse: ['login_yes', 'yes', 'y', 'proceed', 'ok', 'sure'],
      negativeResponse: ['login_no', 'no', 'n', 'later', 'not now'],
      onAccept: 'login_questions',
      onDecline: {
        message: "No problem! 😊\n\nWhenever you're ready to access all features, just type 'Login' or 'Start'.",
        resetState: false
      },
      questions: [
        {
          id: 1,
          text: "📧 Please provide your email address:",
          field: 'email',
          validation: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
          errorMessage: '❌ Invalid email format. Please provide a valid email address.'
        },
        {
          id: 2,
          text: "🏢 What is your organization name?",
          field: 'organization',
          validation: (value) => value.length > 2,
          errorMessage: '❌ Organization name should be at least 3 characters.'
        },
        {
          id: 3,
          text: "👤 What is your role?",
          field: 'role',
          validation: (value) => value.length > 0,
          errorMessage: '❌ Please provide your role.'
        },
        {
          id: 4,
          text: "🏛️ Which department do you belong to?",
          field: 'department',
          validation: (value) => value.length > 0,
          errorMessage: '❌ Please provide your department.'
        }
      ],
      completionMessage: (userInfo) => {
        return `🎉 Awesome! Your profile is complete!\n\n` +
               `📋 Here's your information:\n` +
               `👤 Name: ${userInfo.name}\n` +
               `📧 Email: ${userInfo.email}\n` +
               `🏢 Organization: ${userInfo.organization}\n` +
               `💼 Role: ${userInfo.role}\n` +
               `🏛️ Department: ${userInfo.department}\n\n` +
               `You're all set! How can I help you today?`;
      }
    },
  
    // Feedback Flow
    feedback: {
      name: 'Feedback Flow',
      initialPrompt: {
        text: 'We value your feedback! 💬 Would you like to share your experience with us?',
        buttons: [
          { id: 'feedback_yes', title: '✅ Yes, Share' },
          { id: 'feedback_no', title: '❌ Not Now' }
        ]
      },
      positiveResponse: ['feedback_yes', 'yes', 'y', 'share', 'ok'],
      negativeResponse: ['feedback_no', 'no', 'n', 'later'],
      onAccept: 'feedback_questions',
      onDecline: {
        message: "Thank you! You can share feedback anytime by typing 'Feedback'. 😊",
        resetState: true
      },
      questions: [
        {
          id: 1,
          text: "⭐ How would you rate your experience? (1-5)",
          field: 'rating',
          validation: (value) => /^[1-5]$/.test(value),
          errorMessage: '❌ Please provide a rating between 1 and 5.'
        },
        {
          id: 2,
          text: "💭 What did you like most?",
          field: 'liked',
          validation: (value) => value.length > 5,
          errorMessage: '❌ Please provide more details (at least 5 characters).'
        },
        {
          id: 3,
          text: "🔧 What can we improve?",
          field: 'improvement',
          validation: (value) => value.length > 5,
          errorMessage: '❌ Please provide more details (at least 5 characters).'
        }
      ],
      completionMessage: (userInfo) => {
        return `🙏 Thank you for your valuable feedback!\n\n` +
               `⭐ Rating: ${userInfo.rating}/5\n` +
               `💚 Liked: ${userInfo.liked}\n` +
               `🔧 Improvement: ${userInfo.improvement}\n\n` +
               `We appreciate your input!`;
      }
    },
  
    // Support Request Flow
    support: {
      name: 'Support Flow',
      initialPrompt: {
        text: 'Need help? 🆘 Would you like to create a support ticket?',
        buttons: [
          { id: 'support_yes', title: '✅ Yes, Create Ticket' },
          { id: 'support_no', title: '❌ No Thanks' }
        ]
      },
      positiveResponse: ['support_yes', 'yes', 'y', 'create', 'help'],
      negativeResponse: ['support_no', 'no', 'n'],
      onAccept: 'support_questions',
      onDecline: {
        message: "No problem! Type 'Support' anytime you need assistance. 👍",
        resetState: true
      },
      questions: [
        {
          id: 1,
          text: "🏷️ What's the issue category?\n1. Technical\n2. Billing\n3. General\n4. Other",
          field: 'category',
          validation: (value) => ['1', '2', '3', '4', 'technical', 'billing', 'general', 'other'].includes(value.toLowerCase()),
          errorMessage: '❌ Please select a valid category (1-4).'
        },
        {
          id: 2,
          text: "📝 Please describe your issue in detail:",
          field: 'description',
          validation: (value) => value.length > 10,
          errorMessage: '❌ Please provide more details (at least 10 characters).'
        },
        {
          id: 3,
          text: "🔴 Priority level?\n1. Low\n2. Medium\n3. High\n4. Critical",
          field: 'priority',
          validation: (value) => ['1', '2', '3', '4'].includes(value),
          errorMessage: '❌ Please select a valid priority (1-4).'
        }
      ],
      completionMessage: (userInfo) => {
        const categoryMap = { '1': 'Technical', '2': 'Billing', '3': 'General', '4': 'Other' };
        const priorityMap = { '1': 'Low', '2': 'Medium', '3': 'High', '4': 'Critical' };
        
        return `✅ Support ticket created successfully!\n\n` +
               `🎫 Ticket ID: #${Date.now()}\n` +
               `🏷️ Category: ${categoryMap[userInfo.category] || userInfo.category}\n` +
               `🔴 Priority: ${priorityMap[userInfo.priority]}\n` +
               `📝 Description: ${userInfo.description}\n\n` +
               `Our team will get back to you shortly! ⏱️`;
      }
    }
  };
  
  module.exports = conversationFlows;