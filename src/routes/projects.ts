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

      return res.json({
        projectId,
        operations,
        version: ops.length > 0 ? ops[ops.length - 1].version_int : 0,
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
        version: snapshot.version_int,
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
        return res.status(400).json({ error: 'INVALID_REQUEST', details: parsed.error });
      }

      const { baseVersion, ops } = parsed.data;

      // Check access
      const project = await knex('projects')
        .select('owner_user_id')
        .where('id', projectId)
        .first();

      if (!project) {
        return res.status(404).json({ error: 'PROJECT_NOT_FOUND' });
      }

      // For shared DAW, allow all authenticated users
      // TODO: For private projects, check ownership/collaboration

      // Use a transaction to ensure atomic version increments
      const result = await knex.transaction(async (trx) => {
        // Get current version
        const currentSnapshot = await trx('project_snapshot')
          .select('version_int', 'snapshot_json')
          .where('project_id', projectId)
          .first();

        if (!currentSnapshot) {
          throw new Error('SNAPSHOT_NOT_FOUND');
        }

        const currentVersion = currentSnapshot.version_int;

        // Check if ops are based on current or old version
        if (baseVersion > currentVersion) {
          throw new Error('FUTURE_VERSION');
        }

        // Filter ops that haven't been applied yet (version > currentVersion)
        // In a simple last-write-wins model, we can just append all ops
        const opsToInsert = ops.map((op, idx) => ({
          project_id: projectId,
          version_int: currentVersion + idx + 1,
          op_json: JSON.stringify(op),
        }));

        if (opsToInsert.length === 0) {
          return { newVersion: currentVersion, appliedCount: 0 };
        }

        // Insert ops
        await trx('project_ops').insert(opsToInsert);

        const newVersion = currentVersion + opsToInsert.length;

        // TODO: Rebuild snapshot from ops periodically (for now, just increment version)
        // For MVP, we could skip snapshot rebuilding and rely on ops log
        // But let's update the version at least
        await trx('project_snapshot')
          .where('project_id', projectId)
          .update({
            version_int: newVersion,
            updated_at: knex.fn.now(),
          });

        return { newVersion, appliedCount: opsToInsert.length };
      });

      return res.json(result);
    } catch (error: any) {
      console.error('Error submitting ops:', error);
      
      if (error.message === 'SNAPSHOT_NOT_FOUND') {
        return res.status(404).json({ error: 'SNAPSHOT_NOT_FOUND' });
      }
      
      if (error.message === 'FUTURE_VERSION') {
        return res.status(409).json({ error: 'VERSION_CONFLICT' });
      }

      return res.status(500).json({ error: 'INTERNAL_ERROR' });
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
