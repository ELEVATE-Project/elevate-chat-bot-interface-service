// ============================================
// FILE: routes/mcpRoutes.js
// ============================================
const express = require('express');
const router = express.Router();
const Logger = require('../utils/logger');

// Import services
const programService = require('../services/programService');
const projectService = require('../services/projectService');
const taskService = require('../services/taskService');
const storyService = require('../services/storyService');
const projectSubmissionService = require('../services/projectSubmissionService');
const Project = require('../database/models/project');
const usersQueries = require('../database/databaseQueries/userQueries');

// Middleware to log MCP requests
router.use((req, res, next) => {
  Logger.info('MCP Request Received', {
    tool: req.path.replace('/mcp/', ''),
    phoneNumber: req.body?.phoneNumber,
    timestamp: new Date().toISOString()
  });
  next();
});

// ============================================
// MCP API ENDPOINTS
// ============================================

/**
 * List Programs
 * POST /mcp/list_programs
 */
router.post('/list_programs', async (req, res) => {
  try {
    const { phoneNumber, page = 1 } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: phoneNumber'
      });
    }

    Logger.info('MCP: List Programs', { phoneNumber, page });

    // Call service function - this sends WhatsApp message
    await programService.listPrograms(phoneNumber, page);

    res.json({
      success: true,
      action: 'list_programs',
      message: 'Programs displayed to user',
      phoneNumber,
      page
    });
  } catch (error) {
    Logger.error('MCP: List Programs Error', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * List Projects
 * POST /mcp/list_projects
 */
router.post('/list_projects', async (req, res) => {
  try {
    const { phoneNumber, page = 1 } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: phoneNumber'
      });
    }

    Logger.info('MCP: List Projects', { phoneNumber, page });

    // Call service function - this sends WhatsApp message
    await projectService.listProjects(phoneNumber, page);

    res.json({
      success: true,
      action: 'list_projects',
      message: 'Projects displayed to user',
      phoneNumber,
      page
    });
  } catch (error) {
    Logger.error('MCP: List Projects Error', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Show Tasks
 * POST /mcp/show_tasks
 */
router.post('/show_tasks', async (req, res) => {
  try {
    const { phoneNumber, projectId } = req.body;

    if (!phoneNumber || !projectId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: phoneNumber, projectId'
      });
    }

    Logger.info('MCP: Show Tasks', { phoneNumber, projectId });

    // Get project data
    const projectData = await Project.findOne(
      { projectId, phoneNumber },
      { tasks: 1, projectName: 1, projectData: 1 }
    ).lean();

    if (!projectData) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    // Call service function - this sends WhatsApp message
    await taskService.showTasksMenu(phoneNumber, projectData);

    res.json({
      success: true,
      action: 'show_tasks',
      projectId,
      projectName: projectData.projectName,
      taskCount: projectData.tasks?.length || 0
    });
  } catch (error) {
    Logger.error('MCP: Show Tasks Error', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Update Task Status
 * POST /mcp/update_task_status
 */
router.post('/update_task_status', async (req, res) => {
  try {
    const { phoneNumber, taskIndex, status } = req.body;

    if (!phoneNumber || !taskIndex || !status) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: phoneNumber, taskIndex, status'
      });
    }

    const validStatuses = ['pending', 'in_progress', 'completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    Logger.info('MCP: Update Task Status', { phoneNumber, taskIndex, status });

    // Call service function - this sends WhatsApp message
    await taskService.handleStatusUpdate(phoneNumber, taskIndex, status);

    res.json({
      success: true,
      action: 'update_task_status',
      taskIndex,
      status,
      phoneNumber
    });
  } catch (error) {
    Logger.error('MCP: Update Task Status Error', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Start New Project
 * POST /mcp/start_new_project
 */
router.post('/start_new_project', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: phoneNumber'
      });
    }

    Logger.info('MCP: Start New Project', { phoneNumber });

    // Update user's flow state
    await usersQueries.updateLastMessage(phoneNumber, {
      flow: 'project_creation',
      step: 0,
      context: {},
      text: 'start_new_project'
    });

    // Call service function - this sends WhatsApp message
    await projectService.startNewProjectFlow(phoneNumber);

    res.json({
      success: true,
      action: 'start_new_project',
      phoneNumber
    });
  } catch (error) {
    Logger.error('MCP: Start New Project Error', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Submit Project
 * POST /mcp/submit_project
 */
router.post('/submit_project', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: phoneNumber'
      });
    }

    Logger.info('MCP: Submit Project', { phoneNumber });

    // Call service function - this sends WhatsApp message
    await projectSubmissionService.submitImprovementProject(phoneNumber);

    res.json({
      success: true,
      action: 'submit_project',
      phoneNumber
    });
  } catch (error) {
    Logger.error('MCP: Submit Project Error', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * View Certificate
 * POST /mcp/view_certificate
 */
router.post('/view_certificate', async (req, res) => {
  try {
    const { phoneNumber, projectId } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: phoneNumber'
      });
    }

    Logger.info('MCP: View Certificate', { phoneNumber, projectId });

    // Call appropriate service function - this sends WhatsApp message
    if (projectId) {
      await projectService.showCertificateOptions(phoneNumber, { projectId });
    } else {
      await projectSubmissionService.handleViewCertificate(phoneNumber);
    }

    res.json({
      success: true,
      action: 'view_certificate',
      phoneNumber,
      projectId: projectId || 'all'
    });
  } catch (error) {
    Logger.error('MCP: View Certificate Error', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Record Story
 * POST /mcp/record_story
 */
router.post('/record_story', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: phoneNumber'
      });
    }

    Logger.info('MCP: Record Story', { phoneNumber });

    // Call service function - this sends WhatsApp message
    await storyService.startStoryRecording(phoneNumber);

    res.json({
      success: true,
      action: 'record_story',
      phoneNumber
    });
  } catch (error) {
    Logger.error('MCP: Record Story Error', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get User Context (for Claude)
 * POST /mcp/get_user_context
 */
router.post('/get_user_context', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: phoneNumber'
      });
    }

    Logger.info('MCP: Get User Context', { phoneNumber });

    const lastMessage = await usersQueries.getLastMessage(phoneNumber);
    const user = await usersQueries.findUserByPhone(phoneNumber);

    const userProjects = await Project.find(
      { phoneNumber },
      { projectId: 1, projectName: 1, tasks: 1, submissionStatus: 1 }
    ).lean();

    res.json({
      success: true,
      user: {
        name: user?.name,
        phoneNumber
      },
      currentFlow: lastMessage?.flow,
      currentContext: lastMessage?.context,
      projects: userProjects.map((p) => ({
        projectId: p.projectId,
        projectName: p.projectName,
        taskCount: p.tasks?.length || 0,
        submissionStatus: p.submissionStatus
      }))
    });
  } catch (error) {
    Logger.error('MCP: Get User Context Error', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post("/search_project_by_name", async (req, res) => {
  try {
    const { phoneNumber, projectName } = req.body;

    Logger.info("MCP: Search project by name", {
      phoneNumber,
      projectName,
    });

    // Validate inputs
    if (!phoneNumber || !projectName) {
      return res.status(400).json({
        success: false,
        message: "phoneNumber and projectName are required",
      });
    }

    // Call project service
    const result = await projectService.searchProjectByName(
      phoneNumber,
      projectName
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    Logger.error("MCP: Error searching project by name", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;