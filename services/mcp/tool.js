// ============================================
// FILE: services/mcp/tools.js
// ============================================

/**
 * MCP Tool Definitions
 * Each tool is a function the LLM can call
 */

const projectService = require('../projectService');
const taskService = require('../taskService');
const storyService = require('../storyService');
const projectSubmissionService = require('../projectSubmissionService');
const programService = require('../programService');

const mcpTools = [
  // ============================================
  // PROJECT TOOLS
  // ============================================
  {
    name: 'view_all_projects',
    description: 'List all projects for the user',
    parameters: {
      type: 'object',
      properties: {
        page: {
          type: 'number',
          description: 'Page number for pagination (default: 1)'
        }
      },
      required: []
    },
    execute: async (phoneNumber, params) => {
      await projectService.listProjects(phoneNumber, params.page || 1);
      return { success: true, message: 'Projects listed' };
    }
  },

  {
    name: 'get_project_details',
    description: 'Get detailed information about a specific project',
    parameters: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID or name'
        }
      },
      required: ['project_id']
    },
    execute: async (phoneNumber, params, context) => {
      const projectId = await resolveProjectId(phoneNumber, params.project_id, context);
      if (!projectId) {
        throw new Error('Project not found');
      }
      const project = await Project.findOne({ projectId, phoneNumber }).lean();
      return { success: true, project };
    }
  },

  {
    name: 'get_project_status',
    description: 'Get project progress and completion status',
    parameters: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID'
        }
      },
      required: []
    },
    execute: async (phoneNumber, params, context) => {
      const projectId = await resolveProjectId(phoneNumber, params.project_id, context);
      const project = await Project.findOne({ projectId, phoneNumber }).lean();
      
      if (!project) throw new Error('Project not found');
      
      const tasks = project.tasks || [];
      const completed = tasks.filter(t => t.status === 'completed').length;
      const total = tasks.length;
      const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
      
      return {
        success: true,
        projectName: project.projectName,
        progress,
        completedTasks: completed,
        totalTasks: total,
        status: project.submissionStatus || 'In Progress',
        tasks: tasks.map((t, i) => ({
          number: i + 1,
          name: t.taskName,
          status: t.status
        }))
      };
    }
  },

  {
    name: 'submit_project',
    description: 'Submit a completed project for review',
    parameters: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID to submit (optional if only one project)'
        }
      },
      required: []
    },
    execute: async (phoneNumber, params) => {
      await projectSubmissionService.submitImprovementProject(phoneNumber);
      return { success: true, message: 'Project submitted' };
    }
  },

  // ============================================
  // TASK TOOLS
  // ============================================
  {
    name: 'view_tasks',
    description: 'List all tasks in a project',
    parameters: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID'
        },
        page: {
          type: 'number',
          description: 'Page number (default: 1)'
        }
      },
      required: []
    },
    execute: async (phoneNumber, params, context) => {
      const projectId = await resolveProjectId(phoneNumber, params.project_id, context);
      const project = await Project.findOne({ projectId, phoneNumber }).lean();
      
      if (!project) throw new Error('Project not found');
      
      await taskService.showTasksMenu(phoneNumber, project);
      return { success: true, tasks: project.tasks };
    }
  },

  {
    name: 'get_task_details',
    description: 'Get detailed information about a specific task',
    parameters: {
      type: 'object',
      properties: {
        task_number: {
          type: 'number',
          description: 'Task number (1, 2, 3, etc.)'
        },
        task_name: {
          type: 'string',
          description: 'Task name to search for'
        },
        project_id: {
          type: 'string',
          description: 'Project ID (optional if in active project)'
        }
      },
      required: []
    },
    execute: async (phoneNumber, params, context) => {
      const projectId = await resolveProjectId(phoneNumber, params.project_id, context);
      const project = await Project.findOne({ projectId, phoneNumber }).lean();
      
      if (!project) throw new Error('Project not found');
      
      let taskIndex = params.task_number;
      if (!taskIndex && params.task_name) {
        taskIndex = project.tasks.findIndex(t =>
          t.taskName.toLowerCase().includes(params.task_name.toLowerCase())
        ) + 1;
      }
      
      if (!taskIndex || taskIndex < 1 || taskIndex > project.tasks.length) {
        throw new Error('Task not found');
      }
      
      await taskService.showTaskDetails(phoneNumber, taskIndex);
      return { success: true, task: project.tasks[taskIndex - 1] };
    }
  },

  {
    name: 'update_task_status',
    description: 'Update task completion status',
    parameters: {
      type: 'object',
      properties: {
        task_number: {
          type: 'number',
          description: 'Task number'
        },
        new_status: {
          type: 'string',
          enum: ['notStarted', 'inProgress', 'completed'],
          description: 'New task status'
        },
        task_name: {
          type: 'string',
          description: 'Task name (alternative to task_number)'
        }
      },
      required: ['new_status']
    },
    execute: async (phoneNumber, params, context) => {
      const projectId = await resolveProjectId(phoneNumber, params.project_id, context);
      const project = await Project.findOne({ projectId, phoneNumber }).lean();
      
      let taskIndex = params.task_number;
      if (!taskIndex && params.task_name) {
        taskIndex = project.tasks.findIndex(t =>
          t.taskName.toLowerCase().includes(params.task_name.toLowerCase())
        ) + 1;
      }
      
      await taskService.handleStatusUpdate(phoneNumber, taskIndex, params.new_status);
      return { success: true, message: `Task ${taskIndex} status updated to ${params.new_status}` };
    }
  },

  {
    name: 'upload_evidence',
    description: 'Prepare to upload evidence/proof for a task',
    parameters: {
      type: 'object',
      properties: {
        task_number: {
          type: 'number',
          description: 'Task number'
        },
        task_name: {
          type: 'string',
          description: 'Task name'
        }
      },
      required: []
    },
    execute: async (phoneNumber, params, context) => {
      const projectId = await resolveProjectId(phoneNumber, params.project_id, context);
      const project = await Project.findOne({ projectId, phoneNumber }).lean();
      
      let taskIndex = params.task_number;
      if (!taskIndex && params.task_name) {
        taskIndex = project.tasks.findIndex(t =>
          t.taskName.toLowerCase().includes(params.task_name.toLowerCase())
        ) + 1;
      }
      
      await taskService.handleEvidenceUploadPrompt(phoneNumber, taskIndex);
      return { success: true, message: `Ready to upload evidence for task ${taskIndex}` };
    }
  },

  {
    name: 'view_task_resources',
    description: 'View learning materials and resources for a task',
    parameters: {
      type: 'object',
      properties: {
        task_number: {
          type: 'number',
          description: 'Task number'
        },
        task_name: {
          type: 'string',
          description: 'Task name'
        }
      },
      required: []
    },
    execute: async (phoneNumber, params, context) => {
      const projectId = await resolveProjectId(phoneNumber, params.project_id, context);
      const project = await Project.findOne({ projectId, phoneNumber }).lean();
      
      let taskIndex = params.task_number;
      if (!taskIndex && params.task_name) {
        taskIndex = project.tasks.findIndex(t =>
          t.taskName.toLowerCase().includes(params.task_name.toLowerCase())
        ) + 1;
      }
      
      await taskService.showTaskResources(phoneNumber, taskIndex);
      return { success: true };
    }
  },

  // ============================================
  // STORY TOOLS
  // ============================================
  {
    name: 'record_story',
    description: 'Start recording a story or reflection',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    },
    execute: async (phoneNumber, params) => {
      await storyService.startStoryRecording(phoneNumber);
      return { success: true, message: 'Story recording started' };
    }
  },

  {
    name: 'view_stories',
    description: 'View all recorded stories',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    },
    execute: async (phoneNumber, params) => {
      // TODO: Implement story viewing
      return { success: true, message: 'Stories viewing coming soon' };
    }
  },

  // ============================================
  // REPORT & CERTIFICATE TOOLS
  // ============================================
  {
    name: 'view_project_report',
    description: 'View project report and summary',
    parameters: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID'
        }
      },
      required: []
    },
    execute: async (phoneNumber, params, context) => {
      const projectId = await resolveProjectId(phoneNumber, params.project_id, context);
      await projectService.generateProjectReport(phoneNumber, projectId);
      return { success: true };
    }
  },

  {
    name: 'view_certificate',
    description: 'View project completion certificate',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    },
    execute: async (phoneNumber, params) => {
      await projectSubmissionService.handleViewCertificate(phoneNumber);
      return { success: true };
    }
  },

  {
    name: 'share_certificate',
    description: 'Share certificate with others',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    },
    execute: async (phoneNumber, params) => {
      await projectSubmissionService.handleShareCertificate(phoneNumber);
      return { success: true };
    }
  },

  // ============================================
  // ANALYTICS TOOLS
  // ============================================
  {
    name: 'view_analytics',
    description: 'View program analytics and statistics',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    },
    execute: async (phoneNumber, params) => {
      await programService.showAnalyticsMenu(phoneNumber);
      return { success: true };
    }
  },

  {
    name: 'view_program_report',
    description: 'View program-level reports',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    },
    execute: async (phoneNumber, params) => {
      await programService.listPrograms(phoneNumber, 1);
      return { success: true };
    }
  }
];

module.exports = {
  tools: mcpTools,
  getToolByName: (name) => mcpTools.find(t => t.name === name),
  getAllTools: () => mcpTools
};