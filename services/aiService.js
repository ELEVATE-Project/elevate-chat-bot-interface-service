// ============================================
// FILE: services/aiService.js - FIXED VERSION
// ============================================
const axios = require("axios");
const Logger = require("../utils/logger");

class AIService {
  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
    this.provider = process.env.AI_PROVIDER || "anthropic";
    this.model = process.env.AI_MODEL || "claude-3-5-sonnet-20241022";
  }

  /**
   * Define MCP tools that Claude can use
   */
  getMCPTools() {
    return [
      {
        name: "list_programs",
        description: "List all programs available for the user",
        input_schema: {
          type: "object",
          properties: {
            phoneNumber: {
              type: "string",
              description: "User's phone number",
            },
            page: {
              type: "number",
              description: "Page number (default: 1)",
            },
          },
          required: ["phoneNumber"],
        },
      },
      {
        name: "list_projects",
        description: "List all projects for the user",
        input_schema: {
          type: "object",
          properties: {
            phoneNumber: {
              type: "string",
              description: "User's phone number",
            },
            page: {
              type: "number",
              description: "Page number (default: 1)",
            },
          },
          required: ["phoneNumber"],
        },
      },
      {
        name: "show_tasks",
        description: "Show all tasks for a specific project",
        input_schema: {
          type: "object",
          properties: {
            phoneNumber: {
              type: "string",
              description: "User's phone number",
            },
            projectId: {
              type: "string",
              description: "Project ID",
            },
          },
          required: ["phoneNumber", "projectId"],
        },
      },
      {
        name: "update_task_status",
        description: "Update the status of a task",
        input_schema: {
          type: "object",
          properties: {
            phoneNumber: {
              type: "string",
              description: "User's phone number",
            },
            taskIndex: {
              type: "number",
              description: "Task index (1-based)",
            },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed"],
              description: "New task status",
            },
          },
          required: ["phoneNumber", "taskIndex", "status"],
        },
      },
      {
        name: "start_new_project",
        description: "Start creating a new project",
        input_schema: {
          type: "object",
          properties: {
            phoneNumber: {
              type: "string",
              description: "User's phone number",
            },
          },
          required: ["phoneNumber"],
        },
      },
      {
        name: "submit_project",
        description: "Submit a completed improvement project",
        input_schema: {
          type: "object",
          properties: {
            phoneNumber: {
              type: "string",
              description: "User's phone number",
            },
          },
          required: ["phoneNumber"],
        },
      },
      {
        name: "view_certificate",
        description: "View user's completion certificate",
        input_schema: {
          type: "object",
          properties: {
            phoneNumber: {
              type: "string",
              description: "User's phone number",
            },
            projectId: {
              type: "string",
              description: "Project ID (optional)",
            },
          },
          required: ["phoneNumber"],
        },
      },
      {
        name: "record_story",
        description: "Start recording a story or reflection",
        input_schema: {
          type: "object",
          properties: {
            phoneNumber: {
              type: "string",
              description: "User's phone number",
            },
          },
          required: ["phoneNumber"],
        },
      },
      {
        name: "get_user_context",
        description: "Get user's current context and projects",
        input_schema: {
          type: "object",
          properties: {
            phoneNumber: {
              type: "string",
              description: "User's phone number",
            },
          },
          required: ["phoneNumber"],
        },
      },
      {
        name: "search_project_by_name",
        description:
          "Search for a project by name. Returns project details if found, or list of matching projects if multiple matches.",
        input_schema: {
          type: "object",
          properties: {
            phoneNumber: {
              type: "string",
              description: "User's phone number",
            },
            projectName: {
              type: "string",
              description: "Name of the project to search for",
            },
          },
          required: ["phoneNumber", "projectName"],
        },
      },
    ];
  }

  /**
   * Build system prompt for Claude
   */
  buildSystemPrompt(context) {
    const availableProjects = context.projects || [];

    return `You are an intelligent assistant for a WhatsApp bot managing improvement projects.
  
  USER CONTEXT:
  - Name: ${context.userName || "User"}
  - Projects: ${availableProjects.length}
  - Current Flow: ${context.currentFlow || "None"}
  
  AVAILABLE INTENTS (Select one):
  
  PROJECT ACTIONS:
  - view_projects: User wants to see all their projects
  - view_project_details: User wants to see details of a SPECIFIC project (by name)
  - start_improvement_project: Start creating a new improvement project
  - submit_project: Submit a completed project for review
  
  TASK ACTIONS:
  - view_tasks: Show tasks in a project
  - update_task_status: Change task status (pending/in_progress/completed)
  
  STORY/REFLECTION:
  - record_story: User wants to record a story or reflection
  
  REPORTS & CERTIFICATES:
  - view_certificate: View completion certificate
  
  HELP:
  - ask_help: User needs assistance or how-to guidance
  - general_chat: Casual conversation
  
  TOOL USAGE GUIDELINES:
  - "Show my projects" / "List projects" → Use list_projects tool
  - "Show me [project name]" / "Open [project name]" / "[project name] details" → Use search_project_by_name tool with projectName
  - "Update task 3 to done" → Use update_task_status tool with taskIndex: 3, status: "completed"
  - "Record a story" → Use record_story tool
  - "Show certificate" → Use view_certificate tool
  - "View Report"/"view Program report"/"list program report" → Use list_programs tool
  
  IMPORTANT: When user mentions a specific project name, ALWAYS use search_project_by_name tool.
  Extract the project name from queries like:
  - "Show me single pro with block"
  - "Open my literacy project"
  - "I want to see the science fair project"
  
  Always extract the user's phone number from context and pass it to tools.
  
  RESPONSE FORMAT (JSON ONLY):
  {
    "intent": "intent_name",
    "confidence": 0.0-1.0,
    "entities": {
      "project_name": null,
      "project_id": null,
      "task_number": null,
      "status": null
    },
    "clarification_question": "Only if confidence < 0.7"
  }`;
  }

  /**
   * Analyze user intent using Claude API with MCP tools
   */
  async analyzeUserIntent(
    userMessage,
    conversationContext = {},
    conversationHistory = []
  ) {
    try {
      Logger.info("AIService: Analyzing intent with Claude", {
        message: userMessage.substring(0, 50),
        provider: this.provider,
      });

      const systemPrompt = this.buildSystemPrompt(conversationContext);

      let response;

      if (this.provider === "anthropic" || this.provider === "claude") {
        response = await this.callClaude(
          systemPrompt,
          userMessage,
          conversationContext.phoneNumber
        );
      } else {
        response = await this.callOpenAI(systemPrompt, userMessage);
      }


      const intent = this.parseIntentResponse(response);

      Logger.info("AIService: Intent analyzed", {
        intent: intent.intent,
        confidence: intent.confidence,
        entities: intent.entities,
      });

      return intent;
    } catch (error) {
      Logger.error("AIService: Error analyzing intent", error);
      return {
        intent: "general_chat",
        confidence: 0.3,
        entities: {},
        needsClarification: true,
        clarificationQuestion:
          "I didn't quite understand. Could you rephrase that?",
      };
    }
  }

  /**
   * Call Claude API with MCP tools configured
   * ✅ FIXED: Now handles multiple content blocks correctly
   */
  async callClaude(systemPrompt, userMessage, phoneNumber) {
    try {
      const mcpTools = this.getMCPTools();

      Logger.info("AIService: Calling Claude with MCP tools", {
        toolCount: mcpTools.length,
        phoneNumber,
      });

      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: this.model,
          max_tokens: 500,
          system: systemPrompt,
          tools: mcpTools,
          messages: [
            {
              role: "user",
              content: userMessage,
            },
          ],
        },
        {
          headers: {
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          timeout: 100000,
        }
      );


      if (!response.data.content || response.data.content.length === 0) {
        throw new Error("No content in Claude response");
      }

      // ✅ FIX: Process ALL content blocks, not just the first one
      const contentBlocks = response.data.content;
      let textResponse = "";
      let toolCalls = [];

      // Separate text and tool_use blocks
      for (const block of contentBlocks) {
        if (block.type === "text") {
          textResponse += block.text;
        } else if (block.type === "tool_use") {
          toolCalls.push(block);
        }
      }

      Logger.info("AIService: Claude response analyzed", {
        hasText: textResponse.length > 0,
        toolCallCount: toolCalls.length,
      });

      // ✅ If there are tool calls, execute them
      if (toolCalls.length > 0) {
        // Execute all tool calls (usually there's just one, but handle multiple)
        const toolResults = [];

        for (const toolCall of toolCalls) {
          Logger.info("AIService: Claude wants to use MCP tool", {
            toolName: toolCall.name,
            input: toolCall.input,
          });

          const toolResult = await this.callMCPTool(
            toolCall.name,
            toolCall.input,
            phoneNumber
          );

          toolResults.push({
            toolName: toolCall.name,
            result: toolResult,
          });
        }

        // Return combined response with text (if any) and tool results
        return {
          type: "tool_response",
          textMessage: textResponse || null,
          toolResults: toolResults,
          // For backward compatibility, return the first tool result as main content
          ...toolResults[0].result,
        };
      }

      // ✅ If no tool calls, return text response
      return textResponse;
    } catch (error) {
      Logger.error("AIService: Claude API error", {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
      });
      throw error;
    }
  }

  /**
   * Call your MCP server to execute the tool
   */
  async callMCPTool(toolName, toolInput, phoneNumber) {
    try {
      const mcpServerUrl =
        process.env.MCP_SERVER_URL || "http://localhost:3001";

      Logger.info("AIService: Calling MCP tool via MCP server", {
        tool: toolName,
        mcpUrl: mcpServerUrl,
        phoneNumber,
      });

      toolInput.phoneNumber = phoneNumber; // Ensure phone number is included

      const response = await axios.post(
        `${mcpServerUrl}/mcp/tools/${toolName}`,
        toolInput,
        { timeout: 300000 }
      );

      Logger.info("AIService: MCP tool executed successfully", {
        tool: toolName,
        success: !response.data.isError,
      });

      return response.data;
    } catch (error) {
      Logger.error("AIService: MCP tool call failed", {
        tool: toolName,
        error: error.message,
      });

      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Failed to execute ${toolName}: ${error.message}`,
          },
        ],
      };
    }
  }

  /**
   * Call OpenAI API (fallback)
   */
  async callOpenAI(systemPrompt, userMessage) {
    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          temperature: 0.3,
          response_format: { type: "json_object" },
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 100000,
        }
      );

      return response.data.choices[0].message.content;
    } catch (error) {
      Logger.error("AIService: OpenAI API error", {
        status: error.response?.status,
        message: error.message,
      });
      throw error;
    }
  }

  /**
   * Parse intent response from Claude
   * ✅ FIXED: Now handles tool_response type correctly
   */
  parseIntentResponse(response) {
    try {
      // ✅ Handle new tool_response format
      if (response.type === "tool_response") {
        Logger.info("AIService: Processing tool response", {
          hasText: !!response.textMessage,
          toolCount: response.toolResults?.length || 0,
        });

        // If the tool response has an error
        if (response.isError) {
          return {
            intent: "general_chat",
            confidence: 0.5,
            entities: {},
            needsClarification: true,
            clarificationQuestion: "Something went wrong. Please try again.",
          };
        }

        // Extract the actual tool result content
        // The tool response should have the intent information
        return {
          intent: response.intent || "general_chat",
          confidence: response.confidence || 0.8,
          entities: response.entities || {},
          toolUsed: true,
          textMessage: response.textMessage,
          toolResults: response.toolResults,
        };
      }

      // Handle MCP error response
      if (response.isError) {
        Logger.warn("AIService: MCP returned error", response);
        return {
          intent: "general_chat",
          confidence: 0.5,
          entities: {},
          needsClarification: true,
          clarificationQuestion: "Something went wrong. Please try again.",
        };
      }

      // Parse text response (intent analysis)
      let parsed = response;
      if (typeof response === "string") {
        parsed = JSON.parse(response);
      }

      if (!parsed.intent) {
        throw new Error("Missing intent in response");
      }

      return {
        intent: parsed.intent,
        confidence: parsed.confidence || 0.5,
        entities: parsed.entities || {},
        clarificationQuestion: parsed.clarification_question,
        suggestedAction: parsed.suggested_action,
        needsClarification: (parsed.confidence || 0) < 0.7,
      };
    } catch (error) {
      Logger.error("AIService: Error parsing response", {
        error: error.message,
        response: JSON.stringify(response).substring(0, 100),
      });

      return {
        intent: "general_chat",
        confidence: 0.3,
        entities: {},
        needsClarification: true,
        clarificationQuestion: "I didn't quite understand that.",
      };
    }
  }

  /**
   * Transcribe voice using OpenAI Whisper
   */
  async transcribeVoice(audioBuffer, mimeType = "audio/ogg") {
    try {
      Logger.info("AIService: Transcribing voice message");

      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OpenAI API key required for voice transcription");
      }

      const FormData = require("form-data");
      const form = new FormData();

      form.append("file", audioBuffer, {
        filename: "audio.ogg",
        contentType: mimeType,
      });
      form.append("model", "whisper-1");
      form.append("language", "en");

      const response = await axios.post(
        "https://api.openai.com/v1/audio/transcriptions",
        form,
        {
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          timeout: 30000,
        }
      );

      Logger.info("AIService: Voice transcribed", {
        text: response.data.text.substring(0, 50),
      });

      return {
        success: true,
        text: response.data.text,
        confidence: 0.9,
      };
    } catch (error) {
      Logger.error("AIService: Transcription error", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Extract task number from text
   */
  extractTaskNumber(text) {
    const numMatch = text.match(/\b(\d+)\b/);
    if (numMatch) {
      return parseInt(numMatch[1]);
    }

    const ordinals = {
      first: 1,
      second: 2,
      third: 3,
      fourth: 4,
      fifth: 5,
      sixth: 6,
      seventh: 7,
      eighth: 8,
      ninth: 9,
      tenth: 10,
    };

    for (const [word, num] of Object.entries(ordinals)) {
      if (text.toLowerCase().includes(word)) {
        return num;
      }
    }

    return null;
  }
}

module.exports = new AIService();
