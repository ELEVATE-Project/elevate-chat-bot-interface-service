// ============================================
// FILE: services/aiIntentRouter.js
// ============================================
const Logger = require('../utils/logger');
const usersQueries = require('../database/databaseQueries/userQueries');
const whatsappService = require('./whatsappService');
const projectService = require('./projectService');
const taskService = require('./taskService');
const storyService = require('./storyService');
const projectSubmissionService = require('./projectSubmissionService');
const programService = require('./programService');
const Project = require('../database/models/project');
const aiService = require('./aiService2');

class AIIntentRouter {
  /**
   * Route based on AI-detected intent
   */
  async routeIntent(phoneNumber, intent, context, message) {
    try {
      Logger.info('Routing AI intent', { 
        phoneNumber, 
        intent: intent.intent,
        confidence: intent.confidence 
      });

      const { intent: intentName, entities, confidence } = intent;

      // Handle low confidence
      if (confidence < 0.6) {
        await whatsappService.sendMessage(
          phoneNumber,
          intent.clarificationQuestion || 
          "I'm not sure I understood that. Could you please rephrase?"
        );
        return { success: true, handled: true };
      }

      // Route to specific handler
      switch (intentName) {
        // PROJECT INTENTS
        case 'view_projects':
          return await this.handleViewProjects(phoneNumber);

        case 'view_project_details':
          return await this.handleViewProjectDetails(phoneNumber, entities, context);

        case 'view_project_status':
          return await this.handleViewProjectStatus(phoneNumber, entities, context);

        case 'start_improvement_project':
          return await this.handleStartImprovementProject(phoneNumber, entities, context);

        case 'submit_project':
          return await this.handleSubmitProject(phoneNumber, entities, context);

        // TASK INTENTS
        case 'view_tasks':
          return await this.handleViewTasks(phoneNumber, entities, context);

        case 'view_task_details':
          return await this.handleViewTaskDetails(phoneNumber, entities, context);

        case 'update_task_status':
          return await this.handleUpdateTaskStatus(phoneNumber, entities, context);

        case 'upload_evidence':
          return await this.handleUploadEvidence(phoneNumber, entities, context);

        case 'view_task_resources':
          return await this.handleViewTaskResources(phoneNumber, entities, context);

        // STORY/REFLECTION INTENTS
        case 'record_story':
          return await this.handleRecordStory(phoneNumber, entities, context);

        case 'view_stories':
          return await this.handleViewStories(phoneNumber);

        // REPORTS & CERTIFICATES
        case 'view_report':
          return await this.handleViewReport(phoneNumber, entities, context);

        case 'view_certificate':
          return await this.handleViewCertificate(phoneNumber, entities, context);

        case 'share_certificate':
          return await this.handleShareCertificate(phoneNumber);

        // ANALYTICS
        case 'view_analytics':
          await programService.showAnalyticsMenu(phoneNumber);
          return { success: true, handled: true };

        case 'view_program_report':
          await programService.listPrograms(phoneNumber, 1);
          return { success: true, handled: true };

        // NAVIGATION
        case 'ask_help':
          return await this.handleHelp(phoneNumber);

        case 'back_to_menu':
          await usersQueries.clearLastMessage(phoneNumber);
          const userService = require('./userService');
          return await userService.handleUserMessage(message);

        case 'cancel_action':
          await usersQueries.clearLastMessage(phoneNumber);
          await whatsappService.sendMessage(
            phoneNumber,
            "✅ Cancelled. Type 'menu' to see what you can do."
          );
          return { success: true, handled: true };

        case 'general_chat':
          await whatsappService.sendMessage(
            phoneNumber,
            intent.suggestedAction || 
            "👋 Hello! Type 'help' to see what I can do for you."
          );
          return { success: true, handled: true };

        default:
          return await this.handleUnknownIntent(phoneNumber, intent);
      }
    } catch (error) {
      Logger.error('Error routing AI intent', error);
      return { success: false, handled: false };
    }
  }

  // ============================================
  // PROJECT HANDLERS
  // ============================================

  async handleViewProjects(phoneNumber) {
    await projectService.listProjects(phoneNumber, 1);
    return { success: true, handled: true };
  }

  async handleViewProjectDetails(phoneNumber, entities, context) {
    const projectId = await this.resolveProjectId(phoneNumber, entities, context);
    
    if (!projectId) {
      await whatsappService.sendMessage(
        phoneNumber,
        "📁 Which project would you like to see?\n\nPlease select:"
      );
      await projectService.listProjects(phoneNumber, 1);
      return { success: true, handled: true };
    }

    const project = await Project.findOne({ projectId, phoneNumber }).lean();
    if (project) {
      // Create message object to pass to showProjectDetails
      const message = {
        interactive: {
          list_reply: {
            id: `solutionWithProject_${projectId}`
          }
        }
      };
      await projectService.showProjectDetails(phoneNumber, message);
    }

    return { success: true, handled: true };
  }

  async handleViewProjectStatus(phoneNumber, entities, context) {
    const projectId = await this.resolveProjectId(phoneNumber, entities, context);
    
    if (!projectId) {
      await whatsappService.sendMessage(
        phoneNumber,
        "📁 Select a project to view status:"
      );
      await projectService.listProjects(phoneNumber, 1);
      return { success: true, handled: true };
    }

    const project = await Project.findOne({ projectId, phoneNumber }).lean();
    
    if (!project) {
      await whatsappService.sendMessage(phoneNumber, "❌ Project not found.");
      return { success: true, handled: true };
    }

    const tasks = project.tasks || [];
    const completed = tasks.filter(t => t.status === 'completed').length;
    const total = tasks.length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    await whatsappService.sendMessage(
      phoneNumber,
      `📊 *Project Status: ${project.projectName}*\n\n` +
      `Progress: ${progress}% (${completed}/${total} tasks)\n` +
      `Status: ${project.submissionStatus || 'In Progress'}\n\n` +
      `Tasks:\n` +
      tasks.map((t, i) => {
        const icon = t.status === 'completed' ? '✅' : 
                     t.status === 'inProgress' ? '🔄' : '❌';
        return `${i + 1}. ${icon} ${t.taskName}`;
      }).join('\n')
    );

    return { success: true, handled: true };
  }

  async handleStartImprovementProject(phoneNumber, entities, context) {
    // Not implemented in current system - show message
    await whatsappService.sendMessage(
      phoneNumber,
      "To start an improvement project, please select from available solutions.\n\nShowing your projects:"
    );
    await projectService.listProjects(phoneNumber, 1);
    return { success: true, handled: true };
  }

  async handleSubmitProject(phoneNumber, entities, context) {
    await projectSubmissionService.submitImprovementProject(phoneNumber);
    return { success: true, handled: true };
  }

  // ============================================
  // TASK HANDLERS
  // ============================================

  async handleViewTasks(phoneNumber, entities, context) {
    const projectId = await this.resolveProjectId(phoneNumber, entities, context);
    
    if (!projectId) {
      await whatsappService.sendMessage(
        phoneNumber,
        "📁 Select a project to view tasks:"
      );
      await projectService.listProjects(phoneNumber, 1);
      return { success: true, handled: true };
    }

    const project = await Project.findOne({ projectId, phoneNumber }).lean();
    
    if (project) {
      await taskService.showTasksMenu(phoneNumber, project);
    } else {
      await projectService.listProjects(phoneNumber, 1);
    }

    return { success: true, handled: true };
  }

  async handleViewTaskDetails(phoneNumber, entities, context) {
    const { projectId, taskIndex } = await this.resolveTaskContext(
      phoneNumber, 
      entities, 
      context
    );

    if (!projectId || !taskIndex) {
      await whatsappService.sendMessage(
        phoneNumber,
        "Please specify which task you'd like to view."
      );
      return { success: true, handled: true };
    }

    await taskService.showTaskDetails(phoneNumber, taskIndex);
    return { success: true, handled: true };
  }

  async handleUpdateTaskStatus(phoneNumber, entities, context) {
    const { projectId, taskIndex } = await this.resolveTaskContext(
      phoneNumber, 
      entities, 
      context
    );

    if (!projectId || !taskIndex) {
      await whatsappService.sendMessage(
        phoneNumber,
        "Please specify which task you'd like to update."
      );
      return { success: true, handled: true };
    }

    // Update context
    await usersQueries.updateLastMessage(phoneNumber, {
      flow: 'project_tasks',
      step: 2,
      context: {
        projectId,
        currentTaskIndex: taskIndex
      },
      text: 'ai_update_task'
    });

    // If status is specified, update directly
    if (entities.status) {
      await taskService.handleStatusUpdate(phoneNumber, taskIndex, entities.status);
    } else {
      // Show status update menu
      await taskService.showStatusUpdateMenu(phoneNumber, taskIndex);
    }

    return { success: true, handled: true };
  }

  async handleUploadEvidence(phoneNumber, entities, context) {
    const { projectId, taskIndex } = await this.resolveTaskContext(
      phoneNumber, 
      entities, 
      context
    );

    if (!projectId || !taskIndex) {
      await whatsappService.sendMessage(
        phoneNumber,
        "Please specify which task you'd like to upload evidence for."
      );
      return { success: true, handled: true };
    }

    await taskService.handleEvidenceUploadPrompt(phoneNumber, taskIndex);
    return { success: true, handled: true };
  }

  async handleViewTaskResources(phoneNumber, entities, context) {
    const { projectId, taskIndex } = await this.resolveTaskContext(
      phoneNumber, 
      entities, 
      context
    );

    if (!projectId || !taskIndex) {
      await whatsappService.sendMessage(
        phoneNumber,
        "Please specify which task's resources you'd like to view."
      );
      return { success: true, handled: true };
    }

    await taskService.showTaskResources(phoneNumber, taskIndex);
    return { success: true, handled: true };
  }

  // ============================================
  // STORY HANDLERS
  // ============================================

  async handleRecordStory(phoneNumber, entities, context) {
    await storyService.startStoryRecording(phoneNumber);
    return { success: true, handled: true };
  }

  async handleViewStories(phoneNumber) {
    await whatsappService.sendMessage(
      phoneNumber,
      "📖 Story viewing feature coming soon!"
    );
    return { success: true, handled: true };
  }

  // ============================================
  // REPORT & CERTIFICATE HANDLERS
  // ============================================

  async handleViewReport(phoneNumber, entities, context) {
    const projectId = await this.resolveProjectId(phoneNumber, entities, context);
    
    if (projectId) {
      await projectService.generateProjectReport(phoneNumber, projectId);
    } else {
      await whatsappService.sendMessage(
        phoneNumber,
        "Please select which project report you'd like to view:"
      );
      await projectService.listProjects(phoneNumber, 1);
    }

    return { success: true, handled: true };
  }

  async handleViewCertificate(phoneNumber, entities, context) {
    await projectSubmissionService.handleViewCertificate(phoneNumber);
    return { success: true, handled: true };
  }

  async handleShareCertificate(phoneNumber) {
    await projectSubmissionService.handleShareCertificate(phoneNumber);
    return { success: true, handled: true };
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  async handleHelp(phoneNumber) {
    await whatsappService.sendMessage(
      phoneNumber,
      `💡 *What I Can Help You With:*\n\n` +
      `*Projects:*\n` +
      `• "Show my projects"\n` +
      `• "What's the status of my project"\n` +
      `• "Submit my project"\n\n` +
      `*Tasks:*\n` +
      `• "Show tasks"\n` +
      `• "Update task 3"\n` +
      `• "I completed task 2"\n` +
      `• "Upload evidence for task 1"\n` +
      `• "Show resources for task 2"\n\n` +
      `*Stories & Reports:*\n` +
      `• "Record a story"\n` +
      `• "View my report"\n` +
      `• "Show my certificate"\n\n` +
      `Just tell me what you need in your own words! 😊`
    );
    return { success: true, handled: true };
  }

  async handleUnknownIntent(phoneNumber, intent) {
    await whatsappService.sendMessage(
      phoneNumber,
      `🤔 I'm not sure what you'd like to do.\n\n` +
      `${intent.suggestedAction || "Type 'help' to see what I can do."}`
    );
    return { success: true, handled: true };
  }

  /**
   * Resolve project ID from entities and context
   */
  async resolveProjectId(phoneNumber, entities, context) {
    // Try explicit project ID
    if (entities.project_id) {
      return entities.project_id;
    }

    // Try current project from context
    if (context.currentProject?.projectId) {
      return context.currentProject.projectId;
    }

    // Try to find by project name
    if (entities.project_name && context.projects) {
      const matchingProject = context.projects.find(p => 
        p.projectName.toLowerCase().includes(entities.project_name.toLowerCase())
      );
      if (matchingProject) {
        return matchingProject.projectId;
      }
    }

    // If user has only one project, use that
    if (context.projects?.length === 1) {
      return context.projects[0].projectId;
    }

    return null;
  }

  /**
   * Resolve both project and task from entities and context
   */
  async resolveTaskContext(phoneNumber, entities, context) {
    const projectId = await this.resolveProjectId(phoneNumber, entities, context);
    
    if (!projectId) {
      return { projectId: null, taskIndex: null };
    }

    const project = await Project.findOne({ projectId, phoneNumber }).lean();
    
    if (!project) {
      return { projectId: null, taskIndex: null };
    }

    let taskIndex = null;

    // Try task number
    if (entities.task_number) {
      taskIndex = entities.task_number;
    }
    // Try task name
    else if (entities.task_name) {
      taskIndex = aiService.findMatchingTask(entities.task_name, project.tasks);
    }
    // Try current task from context
    else if (context.currentTask?.taskNumber) {
      taskIndex = context.currentTask.taskNumber;
    }

    return { projectId, taskIndex };
  }
}

module.exports = new AIIntentRouter();