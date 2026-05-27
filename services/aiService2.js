// ============================================
// FILE: services/aiService.js - COMPREHENSIVE VERSION
// ============================================
const axios = require('axios');
const config = require('../config/config');
const Logger = require('../utils/logger');

class AIService {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
    this.provider = process.env.AI_PROVIDER || 'openai';
    this.model = process.env.AI_MODEL || 'gpt-4o-mini';
  }

  /**
   * Comprehensive system prompt covering all bot capabilities
   */
  buildSystemPrompt(context) {
    const availableProjects = context.projects || [];
    const currentProject = context.currentProject || null;
    const currentTask = context.currentTask || null;

    return `You are an intelligent assistant for a WhatsApp bot managing improvement projects with tasks, evidence, stories, reports, and certificates.

AVAILABLE INTENTS (Choose the most specific one):

PROJECT MANAGEMENT:
- view_projects: List all projects ("show my projects", "what projects do I have")
- view_project_details: Show specific project info ("tell me about my project", "project status")
- view_project_status: Show project completion status ("how's my project going", "project progress")
- start_improvement_project: Start a new improvement project
- submit_project: Submit completed project ("submit my project", "I'm done with project")

TASK MANAGEMENT:
- view_tasks: Show all tasks in a project ("show tasks", "what are my tasks")
- view_task_details: Show specific task info ("tell me about task 3", "task details")
- update_task_status: Change task status ("mark task as complete", "I finished task 2")
- upload_evidence: Upload evidence/proof for task ("add evidence", "upload proof", "attach document")
- view_task_resources: View learning materials ("show resources", "view materials")

STORY/REFLECTION:
- record_story: Record a story/reflection ("record story", "share my experience", "tell my story")
- view_stories: View recorded stories

REPORTS & CERTIFICATES:
- view_report: View project report ("show report", "view my report")
- view_certificate: View completion certificate ("show certificate", "my certificate")
- share_certificate: Share certificate with others

ANALYTICS:
- view_analytics: View program analytics ("show analytics", "view stats")
- view_program_report: View program-level reports

HELP & NAVIGATION:
- ask_help: Need assistance ("help", "how do I", "what can I do")
- back_to_menu: Return to main menu ("menu", "go back", "main menu")
- cancel_action: Cancel current action ("cancel", "nevermind", "stop")

GENERAL:
- general_chat: Casual conversation
- unclear: Cannot determine intent clearly

CONTEXT:
${currentProject ? `Current Project: "${currentProject.projectName}" (ID: ${currentProject.projectId})` : 'No active project'}
${currentTask ? `Current Task: "${currentTask.taskName}" (Task #${currentTask.taskNumber})` : 'No active task'}
${availableProjects.length > 0 ? `User has ${availableProjects.length} project(s)` : 'No projects'}

ENTITY EXTRACTION:
Extract these entities when present:
- project_name: Mentioned project name
- project_id: Project identifier if mentioned
- task_number: Task number (1, 2, 3, "first", "second", "third")
- task_name: Specific task name mentioned
- action_type: Specific action (update, upload, view, submit, etc.)
- status: New task status (notStarted, inProgress, completed)
- evidence_type: Type of evidence (document, image, video)
- content_type: Type of content (story, reflection, report)
- time_reference: Time-based reference ("today", "yesterday", "last week")

RESPONSE FORMAT (JSON ONLY):
{
  "intent": "intent_name",
  "confidence": 0.0-1.0,
  "entities": {
    "project_name": "string or null",
    "project_id": "string or null",
    "task_number": number or null,
    "task_name": "string or null",
    "action_type": "string or null",
    "status": "string or null",
    "evidence_type": "string or null",
    "content_type": "string or null"
  },
  "clarification_question": "Ask if confidence < 0.7",
  "suggested_action": "Human-readable action description",
  "requires_context": true/false
}

EXAMPLE MAPPINGS:
"Show project status" → intent: "view_project_status"
"I want to update task 3" → intent: "update_task_status", entities: {"task_number": 3}
"Upload evidence for classroom task" → intent: "upload_evidence", entities: {"task_name": "classroom"}
"Tell me about the second task" → intent: "view_task_details", entities: {"task_number": 2}
"Mark task 1 as complete" → intent: "update_task_status", entities: {"task_number": 1, "status": "completed"}
"Show my certificate" → intent: "view_certificate"
"I finished all tasks" → intent: "submit_project"
"Record a story about my project" → intent: "record_story"
"Show task resources" → intent: "view_task_resources"
"What's my progress" → intent: "view_project_status"
"Upload proof for task 3" → intent: "upload_evidence", entities: {"task_number": 3}
"Open story for this task" → intent: "record_story"
"View project report" → intent: "view_report"

Be precise with intent selection. Always choose the most specific intent that matches the user's request.`;
  }

  /**
   * Build user prompt with conversation history
   */
  buildUserPrompt(userMessage, context, conversationHistory = []) {
    let prompt = '';

    // Add recent conversation for context
    if (conversationHistory.length > 0) {
      prompt += 'Recent conversation:\n';
      conversationHistory.slice(-3).forEach(msg => {
        prompt += `${msg.role}: ${msg.text}\n`;
      });
      prompt += '\n';
    }

    prompt += `Current user message: "${userMessage}"\n\n`;
    
    if (context.currentProject) {
      prompt += `Current context: User is viewing project "${context.currentProject.projectName}"\n`;
    }

    if (context.currentTask) {
      prompt += `Current context: User is on task "${context.currentTask.taskName}"\n`;
    }

    prompt += '\nAnalyze and respond with JSON only.';

    return prompt;
  }

  /**
   * Analyze user message with full context
   */
  async analyzeUserIntent(userMessage, conversationContext = {}, conversationHistory = []) {
    try {
      Logger.info('Analyzing user intent', { 
        message: userMessage.substring(0, 50),
        hasProject: !!conversationContext.currentProject,
        hasTask: !!conversationContext.currentTask
      });

      const systemPrompt = this.buildSystemPrompt(conversationContext);
      const userPrompt = this.buildUserPrompt(userMessage, conversationContext, conversationHistory);

      let response;
      if (this.provider === 'openai') {
        response = await this.callOpenAI(systemPrompt, userPrompt);
      } else {
        response = await this.callAnthropic(systemPrompt, userPrompt);
      }

      const intent = this.parseAIResponse(response);
      
      Logger.info('Intent analyzed successfully', { 
        intent: intent.intent, 
        confidence: intent.confidence,
        entities: intent.entities 
      });
      
      return intent;
    } catch (error) {
      Logger.error('Error analyzing intent', error);
      return {
        intent: 'unclear',
        confidence: 0,
        entities: {},
        needsClarification: true,
        clarificationQuestion: "I didn't quite understand that. Could you please rephrase?"
      };
    }
  }

  /**
   * Call OpenAI API
   */
  async callOpenAI(systemPrompt, userPrompt) {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      return response.data.choices[0].message.content;
    } catch (error) {
      Logger.error('OpenAI API error', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Call Anthropic (Claude) API
   */
  async callAnthropic(systemPrompt, userPrompt) {
    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: this.model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [
            { role: 'user', content: userPrompt }
          ]
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      return response.data.content[0].text;
    } catch (error) {
      Logger.error('Anthropic API error', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Parse and validate AI response
   */
  parseAIResponse(response) {
    try {
      const parsed = JSON.parse(response);
      
      if (!parsed.intent) {
        throw new Error('Invalid response: missing intent');
      }

      return {
        intent: parsed.intent,
        confidence: parsed.confidence || 0.5,
        entities: parsed.entities || {},
        clarificationQuestion: parsed.clarification_question,
        suggestedAction: parsed.suggested_action,
        requiresContext: parsed.requires_context || false,
        needsClarification: parsed.confidence < 0.7
      };
    } catch (error) {
      Logger.error('Error parsing AI response', { error: error.message, response });
      return {
        intent: 'unclear',
        confidence: 0,
        entities: {},
        needsClarification: true
      };
    }
  }

  /**
   * Transcribe voice message using Whisper
   */
  async transcribeVoice(audioBuffer, mimeType = 'audio/ogg') {
    try {
      Logger.info('Transcribing voice message');

      if (this.provider !== 'openai') {
        throw new Error('Voice transcription only available with OpenAI');
      }

      const FormData = require('form-data');
      const form = new FormData();
      
      form.append('file', audioBuffer, {
        filename: 'audio.ogg',
        contentType: mimeType
      });
      form.append('model', 'whisper-1');
      form.append('language', 'en');

      const response = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Authorization': `Bearer ${this.apiKey}`
          },
          timeout: 30000
        }
      );

      Logger.info('Voice transcribed successfully', { 
        text: response.data.text.substring(0, 50) 
      });

      return {
        success: true,
        text: response.data.text
      };
    } catch (error) {
      Logger.error('Error transcribing voice', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Extract task number from natural language
   */
  extractTaskNumber(text, tasks = []) {
    // Check for explicit numbers
    const numMatch = text.match(/\b(\d+)\b/);
    if (numMatch) {
      return parseInt(numMatch[1]);
    }

    // Check for ordinal words
    const ordinals = {
      'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5,
      'sixth': 6, 'seventh': 7, 'eighth': 8, 'ninth': 9, 'tenth': 10
    };

    for (const [word, num] of Object.entries(ordinals)) {
      if (text.toLowerCase().includes(word)) {
        return num;
      }
    }

    return null;
  }

  /**
   * Find matching task by name or number
   */
  findMatchingTask(identifier, tasks = []) {
    if (!identifier || !tasks || tasks.length === 0) {
      return null;
    }

    // Try as number
    if (typeof identifier === 'number') {
      return identifier > 0 && identifier <= tasks.length ? identifier : null;
    }

    // Try as string - match task name
    const searchTerm = identifier.toLowerCase();
    const matchingIndex = tasks.findIndex(task => 
      (task.taskName || task.name || '').toLowerCase().includes(searchTerm)
    );

    return matchingIndex >= 0 ? matchingIndex + 1 : null;
  }
}

module.exports = new AIService();