// ============================================
// FILE: services/mcp/mcpHandler.js
// ============================================

const Logger = require("../../utils/logger");
const { tools, getToolByName } = require("./tools");
const axios = require("axios");

class MCPHandler {
  /**
   * Convert tools to format LLM understands
   */
  formatToolsForLLM() {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: "object",
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    }));
  }

  /**
   * Call LLM with tool definitions (Claude/GPT-4)
   */
  async detectIntentAndGetTools(
    userMessage,
    conversationContext,
    provider = "openai"
  ) {
    try {
      Logger.info("Detecting intent with MCP tools", {
        messageLength: userMessage.length,
        toolCount: tools.length,
      });

      const systemPrompt = this.buildMCPSystemPrompt(conversationContext);

      let response;
      if (provider === "openai") {
        response = await this.callOpenAIWithTools(
          systemPrompt,
          userMessage,
          this.formatToolsForLLM()
        );
      } else {
        response = await this.callClaudeWithTools(
          systemPrompt,
          userMessage,
          this.formatToolsForLLM()
        );
      }

      return response;
    } catch (error) {
      Logger.error("Error detecting intent with MCP", error);
      throw error;
    }
  }

  /**
   * Build system prompt for MCP
   */
  buildMCPSystemPrompt(context) {
    return `You are an intelligent WhatsApp bot assistant for managing improvement projects.

Current User Context:
${
  context.currentProject
    ? `- Current Project: ${context.currentProject.projectName}`
    : "- No active project"
}
${
  context.currentTask
    ? `- Current Task: ${context.currentTask.taskName}`
    : "- No active task"
}
${
  context.projects?.length > 0
    ? `- User has ${context.projects.length} project(s)`
    : ""
}

You have access to tools to help users. When the user sends a message, analyze what they want and use the appropriate tool(s) to help them.

If you need multiple tools, call them in sequence. Always try to understand the user's intent first, then call the most specific tool.

Be smart about tool selection:
- "Show my projects" → view_all_projects
- "What's my project status?" → get_project_status
- "Update task 3 to done" → update_task_status (with status='completed')
- "I completed the classroom task" → update_task_status (with task_name='classroom')
- "Show me resources for task 2" → view_task_resources
- "Upload proof for my work" → upload_evidence`;
  }

  /**
   * Call OpenAI API with tool use (Claude 3.5 Sonnet supports tool use)
   */
  async callOpenAIWithTools(systemPrompt, userMessage, toolDefinitions) {
    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4-turbo",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          tools: toolDefinitions.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.input_schema,
            },
          })),
          tool_choice: "auto",
          temperature: 0.3,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      return response.data.choices[0].message;
    } catch (error) {
      Logger.error("OpenAI API error", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Call Claude API with tool use
   */
  async callClaudeWithTools(systemPrompt, userMessage, toolDefinitions) {
    try {
      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1024,
          system: systemPrompt,
          tools: toolDefinitions.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.input_schema,
          })),
          messages: [{ role: "user", content: userMessage }],
        },
        {
          headers: {
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
        }
      );

      return response.data.content;
    } catch (error) {
      Logger.error("Claude API error", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Execute tool call from LLM
   */
  async executeTool(toolName, toolInput, phoneNumber, context) {
    try {
      Logger.info("Executing MCP tool", { toolName, phoneNumber });

      const tool = getToolByName(toolName);

      if (!tool) {
        throw new Error(`Tool not found: ${toolName}`);
      }

      const result = await tool.execute(phoneNumber, toolInput, context);

      Logger.info("Tool executed successfully", { toolName, result });

      return result;
    } catch (error) {
      Logger.error("Error executing tool", { toolName, error: error.message });
      throw error;
    }
  }

  /**
   * Process LLM response and execute any tool calls
   */
  async processLLMResponse(llmResponse, phoneNumber, context) {
    try {
      const results = [];

      // Check if response contains tool calls
      const toolCalls =
        llmResponse.tool_calls ||
        (Array.isArray(llmResponse) &&
          llmResponse.filter((block) => block.type === "tool_use"));

      if (!toolCalls || toolCalls.length === 0) {
        Logger.info("No tool calls in LLM response");
        return { success: true, toolExecuted: false };
      }

      // Execute each tool call
      for (const toolCall of toolCalls) {
        const toolName = toolCall.name || toolCall.function?.name;
        const toolInput = toolCall.input || toolCall.function?.arguments || {};

        Logger.info("Processing tool call", { toolName });

        const result = await this.executeTool(
          toolName,
          typeof toolInput === "string" ? JSON.parse(toolInput) : toolInput,
          phoneNumber,
          context
        );

        results.push({
          toolName,
          result,
        });
      }

      return {
        success: true,
        toolExecuted: true,
        results,
      };
    } catch (error) {
      Logger.error("Error processing LLM response", error);
      throw error;
    }
  }
}

module.exports = new MCPHandler();
