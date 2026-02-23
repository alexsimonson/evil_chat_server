/**
 * DAW Project routes
 */

import { Router } from 'express';
import type { Knex } from 'knex';
import { requireAuth } from '../middleware/auth';
import { SubmitOpsRequestSchema } from '../types/dawOps';

export function makeProjectsRouter(knex: Knex) {
  const router = Router();

  // Get or create the shared DAW project (special collaborative project)
  router.get('/shared-daw', requireAuth, async (req, res) => {
    try {
      // Look for a project with name "Shared DAW"
      let project = await knex('projects')
        .select('id', 'name', 'created_at', 'updated_at')
        .where('name', 'Shared DAW')
        .first();

      if (!project) {
        // Create the shared DAW project (use first admin user or system)
        const adminUser = await knex('users')
          .select('id')
          .orderBy('id', 'asc')
          .first();

        if (!adminUser) {
          return res.status(500).json({ error: 'NO_USERS_FOUND' });
        }

        const result = await knex.transaction(async (trx) => {
          const [newProject] = await trx('projects')
            .insert({
              name: 'Shared DAW',
              owner_user_id: adminUser.id,
            })
            .returning('*');

          // Create initial snapshot
          const initialState = {
            projectId: newProject.id.toString(),
            version: 0,
            tracks: {},
            audioAssets: {},
            audioClips: {},
            midiClips: {},
            trackOrder: [],
            transport: {
              bpm: 120,
              isPlaying: false,
              isRecording: false,
              positionSeconds: 0,
            },
          };

          await trx('project_snapshot').insert({
            project_id: newProject.id,
            snapshot_json: JSON.stringify(initialState),
            version_int: 0,
          });

          return newProject;
        });

        project = result;
      }

      return res.json(project);
    } catch (error) {
      console.error('Error getting shared DAW project:', error);
      return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // Get all operations for a project (for initial state loading)
  router.get('/:projectId/daw/ops', requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.projectId);
      if (!Number.isFinite(projectId)) {
        return res.status(400).json({ error: 'INVALID_PROJECT_ID' });
      }

      // Check if user has access to this project
      const project = await knex('projects')
        .select('id', 'owner_user_id')
        .where('id', projectId)
        .first();

      if (!project) {
        return res.status(404).json({ error: 'PROJECT_NOT_FOUND' });
      }

      // For shared DAW, allow all authenticated users
      // TODO: For private projects, check ownership/collaboration

      // Fetch all operations in order
      const ops = await knex('project_ops')
        .select('op_json', 'version_int')
        .where('project_id', projectId)
        .orderBy('version_int', 'asc');

      // Knex automatically parses JSONB columns, so op_json is already an object
      const operations = ops.map((row) => row.op_json);

      // Convert BigInt version to number for JSON serialization
      let latestVersion = 0;
      if (ops.length > 0) {
        const rawVersion = ops[ops.length - 1].version_int;
        if (typeof rawVersion === 'bigint') {
          latestVersion = Number(rawVersion);
        } else if (typeof rawVersion === 'string') {
          latestVersion = parseInt(rawVersion, 10);
        } else {
          latestVersion = rawVersion || 0;
        }
      }

      return res.json({
        projectId,
        operations,
        version: latestVersion,
      });
    } catch (error) {
      console.error('Error fetching DAW operations:', error);
      return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // Get project snapshot + current version
  router.get('/:projectId/daw', requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.projectId);
      if (!Number.isFinite(projectId)) {
        return res.status(400).json({ error: 'INVALID_PROJECT_ID' });
      }

      // Check if user has access to this project (is owner or member)
      const project = await knex('projects')
        .select('id', 'name', 'owner_user_id')
        .where('id', projectId)
        .first();

      if (!project) {
        return res.status(404).json({ error: 'PROJECT_NOT_FOUND' });
      }

      // For shared DAW, allow all authenticated users
      // TODO: For private projects, check ownership/collaboration

      // Get or create snapshot
      let snapshot = await knex('project_snapshot')
        .select('snapshot_json', 'version_int')
        .where('project_id', projectId)
        .first();

      if (!snapshot) {
        // Create initial empty snapshot
        const initialState = {
          projectId: projectId.toString(),
          version: 0,
          tracks: {},
          audioAssets: {},
          audioClips: {},
          midiClips: {},
          trackOrder: [],
          transport: {
            bpm: 120,
            isPlaying: false,
            positionSeconds: 0,
          },
        };

        await knex('project_snapshot').insert({
          project_id: projectId,
          snapshot_json: JSON.stringify(initialState),
          version_int: 0,
        });

        snapshot = {
          snapshot_json: initialState, // Already an object
          version_int: 0,
        };
      }

      return res.json({
        snapshot: snapshot.snapshot_json, // Already parsed by Knex
        version: typeof snapshot.version_int === 'bigint' 
          ? Number(snapshot.version_int) 
          : (typeof snapshot.version_int === 'string' 
            ? parseInt(snapshot.version_int, 10) 
            : (snapshot.version_int || 0)),
      });
    } catch (error) {
      console.error('Error fetching DAW snapshot:', error);
      return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // Submit operations
  router.post('/:projectId/daw/ops', requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.projectId);
      if (!Number.isFinite(projectId)) {
        return res.status(400).json({ error: 'INVALID_PROJECT_ID' });
      }

      // Validate request body
      const parsed = SubmitOpsRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        console.error('[DAW] Invalid request:', parsed.error.errors);
        return res.status(400).json({ error: 'INVALID_REQUEST', details: parsed.error });
      }

      const { baseVersion, ops } = parsed.data;
      
      console.log(`[DAW] Received ${ops.length} operation(s) for project ${projectId}, baseVersion: ${baseVersion}`, {
        opTypes: ops.map(op => op.type),
      });

      // Check access
      const project = await knex('projects')
        .select('owner_user_id')
        .where('id', projectId)
        .first();

      if (!project) {
        return res.status(404).json({ error: 'PROJECT_NOT_FOUND' });
      }

      // Get current max version atomically
      const maxOp = await knex('project_ops')
        .where('project_id', projectId)
        .max('version_int as max_version')
        .first();

      let currentVersion = 0;
      if (maxOp && maxOp.max_version !== null && maxOp.max_version !== undefined) {
        // Ensure we're converting to number properly
        const rawVersion = maxOp.max_version;
        console.log(`[DAW] Raw max_version from DB:`, { value: rawVersion, type: typeof rawVersion, constructor: rawVersion?.constructor?.name });
        
        // Handle various types: number, string, BigInt
        let versionNum = 0;
        if (typeof rawVersion === 'number') {
          versionNum = rawVersion;
        } else if (typeof rawVersion === 'string') {
          versionNum = parseInt(rawVersion, 10);
        } else if (typeof rawVersion === 'bigint') {
          versionNum = Number(rawVersion);
        } else {
          console.warn(`[DAW] Unexpected version type:`, typeof rawVersion);
          versionNum = 0;
        }
        
        // Validate the version is reasonable (less than 1 million)
        if (versionNum > 1000000) {
          console.error(`[DAW] Version number suspiciously high:`, versionNum);
          // Reset to 0 if corrupted
          versionNum = 0;
        }
        
        currentVersion = versionNum;
      }

      console.log(`[DAW] Current version: ${currentVersion}, client baseVersion: ${baseVersion}`);

      // Check if ops are based on current or future version
      if (baseVersion > currentVersion) {
        console.warn(`[DAW] Client version ahead: ${baseVersion} > ${currentVersion}`);
        return res.status(409).json({ 
          error: 'VERSION_CONFLICT',
          message: 'Client version is ahead of server',
          serverVersion: currentVersion,
          clientBaseVersion: baseVersion,
        });
      }

      // Calculate new versions for each op
      const opsToInsert = ops.map((op, idx) => {
        const newVersion = currentVersion + idx + 1;
        return {
          project_id: projectId,
          version_int: newVersion,
          op_json: JSON.stringify(op),
        };
      });

      if (opsToInsert.length === 0) {
        return res.json({ newVersion: currentVersion, appliedCount: 0 });
      }

      // Insert all ops - if there's a conflict, it means another request beat us
      try {
        await knex('project_ops').insert(opsToInsert);
      } catch (insertError: any) {
        // Handle duplicate key - fetch the current version and return conflict
        if (insertError.code === '23505' || insertError.message?.includes('duplicate key')) {
          const maxOpRetry = await knex('project_ops')
            .where('project_id', projectId)
            .max('version_int as max_version')
            .first();
          
          let newCurrentVersion = 0;
          if (maxOpRetry?.max_version !== null && maxOpRetry?.max_version !== undefined) {
            const rawVersion = maxOpRetry.max_version;
            if (typeof rawVersion === 'number') {
              newCurrentVersion = rawVersion;
            } else if (typeof rawVersion === 'string') {
              newCurrentVersion = parseInt(rawVersion, 10);
            } else if (typeof rawVersion === 'bigint') {
              newCurrentVersion = Number(rawVersion);
            }
          }
          
          console.warn(`[DAW] Concurrent insert conflict - version updated to ${newCurrentVersion} before we could insert`);
          return res.status(409).json({
            error: 'VERSION_CONFLICT',
            message: 'Another client inserted operations first',
            serverVersion: newCurrentVersion,
            clientBaseVersion: baseVersion,
          });
        }
        throw insertError;
      }

      const newVersion = currentVersion + opsToInsert.length;

      // Update snapshot version
      await knex('project_snapshot')
        .where('project_id', projectId)
        .update({
          version_int: newVersion,
          updated_at: knex.fn.now(),
        });

      console.log(`[DAW] Successfully inserted ops, new version: ${newVersion}`);
      return res.json({ newVersion, appliedCount: opsToInsert.length });
    } catch (error: any) {
      console.error('Error submitting ops:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
      });

      return res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
    }
  });

  // Create a new project
  router.post('/', requireAuth, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'INVALID_NAME' });
      }

      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'UNAUTHENTICATED' });
      }

      const result = await knex.transaction(async (trx) => {
        // Create project
        const [project] = await trx('projects')
          .insert({
            name,
            owner_user_id: userId,
          })
          .returning('*');

        // Create initial snapshot
        const initialState = {
          projectId: project.id.toString(),
          version: 0,
          tracks: {},
          audioAssets: {},
          audioClips: {},
          midiClips: {},
          trackOrder: [],
          transport: {
            bpm: 120,
            isPlaying: false,
            positionSeconds: 0,
          },
        };

        await trx('project_snapshot').insert({
          project_id: project.id,
          snapshot_json: JSON.stringify(initialState),
          version_int: 0,
        });

        return project;
      });

      return res.json(result);
    } catch (error) {
      console.error('Error creating project:', error);
      return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // Upload audio recording for DAW project
  router.post('/:projectId/audio/upload', requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.projectId);
      if (!Number.isFinite(projectId)) {
        return res.status(400).json({ error: 'INVALID_PROJECT_ID' });
      }

      const { audioData, mimeType, duration } = req.body;
      if (!audioData || !mimeType || typeof duration !== 'number') {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
      }

      // Check if user has access to this project
      const project = await knex('projects')
        .select('id')
        .where('id', projectId)
        .first();

      if (!project) {
        return res.status(404).json({ error: 'PROJECT_NOT_FOUND' });
      }

      // Generate asset ID (same format as client-side generation for consistency)
      const assetId = Math.random().toString(36).substring(2, 15);

      // Store the audio asset with data URL
      await knex('project_assets').insert({
        id: assetId,
        project_id: projectId,
        kind: 'audio',
        name: `Recording ${new Date().toLocaleTimeString()}`,
        url: audioData, // Store the data URL directly
        duration,
        mime_type: mimeType,
        file_size: audioData.length,
      });

      console.log(`[Audio] Stored recording as asset ${assetId} for project ${projectId}`);

      return res.json({
        assetId,
        audioUrl: audioData, // Return the data URL
      });
    } catch (error) {
      console.error('Error uploading audio:', error);
      return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // List user's projects
  router.get('/', requireAuth, async (req, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'UNAUTHENTICATED' });
      }

      const projects = await knex('projects')
        .select('id', 'name', 'created_at', 'updated_at')
        .where('owner_user_id', userId)
        .orderBy('updated_at', 'desc');

      return res.json(projects);
    } catch (error) {
      console.error('Error listing projects:', error);
      return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  return router;
}
