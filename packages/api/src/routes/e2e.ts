import { Router } from 'express';
import { db, e2eKeyBundles, e2eOneTimePreKeys, directMessages, agents } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

// Upload/update key bundle
router.post('/keys/bundle', async (req: AuthenticatedRequest, res) => {
  try {
    const myAgentId = req.agent!.id;
    const {
      identityKey,
      signedPreKey,
      signedPreKeyId,
      signedPreKeySignature,
      registrationId,
    } = req.body;

    // Validate required fields
    if (!identityKey || !signedPreKey || signedPreKeyId === undefined || !signedPreKeySignature || registrationId === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required key bundle fields',
      });
    }

    // Upsert key bundle
    const [existing] = await db
      .select()
      .from(e2eKeyBundles)
      .where(eq(e2eKeyBundles.agentId, myAgentId))
      .limit(1);

    if (existing) {
      await db
        .update(e2eKeyBundles)
        .set({
          identityKey,
          signedPreKey,
          signedPreKeyId,
          signedPreKeySignature,
          registrationId,
          updatedAt: new Date(),
        })
        .where(eq(e2eKeyBundles.agentId, myAgentId));
    } else {
      await db.insert(e2eKeyBundles).values({
        agentId: myAgentId,
        identityKey,
        signedPreKey,
        signedPreKeyId,
        signedPreKeySignature,
        registrationId,
      });
    }

    res.json({
      success: true,
      message: 'Key bundle uploaded',
    });
  } catch (error) {
    console.error('Upload key bundle error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload key bundle',
    });
  }
});

// Upload one-time pre-keys
router.post('/keys/prekeys', async (req: AuthenticatedRequest, res) => {
  try {
    const myAgentId = req.agent!.id;
    const { preKeys } = req.body;

    if (!Array.isArray(preKeys) || preKeys.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'preKeys must be a non-empty array',
      });
    }

    // Validate pre-keys
    for (const pk of preKeys) {
      if (pk.keyId === undefined || !pk.publicKey) {
        return res.status(400).json({
          success: false,
          error: 'Each pre-key must have keyId and publicKey',
        });
      }
    }

    // Insert pre-keys
    const values = preKeys.map(pk => ({
      agentId: myAgentId,
      keyId: pk.keyId,
      publicKey: pk.publicKey,
    }));

    await db.insert(e2eOneTimePreKeys).values(values);

    res.json({
      success: true,
      message: `Uploaded ${preKeys.length} pre-keys`,
      count: preKeys.length,
    });
  } catch (error) {
    console.error('Upload pre-keys error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload pre-keys',
    });
  }
});

// Get another agent's key bundle (for session establishment)
router.get('/keys/:agentId/bundle', async (req: AuthenticatedRequest, res) => {
  try {
    const { agentId: targetAgentId } = req.params;

    // Get key bundle
    const [bundle] = await db
      .select()
      .from(e2eKeyBundles)
      .where(eq(e2eKeyBundles.agentId, targetAgentId))
      .limit(1);

    if (!bundle) {
      return res.status(404).json({
        success: false,
        error: 'Agent has not uploaded encryption keys',
      });
    }

    // Get an unused one-time pre-key
    const [oneTimePreKey] = await db
      .select()
      .from(e2eOneTimePreKeys)
      .where(
        and(
          eq(e2eOneTimePreKeys.agentId, targetAgentId),
          eq(e2eOneTimePreKeys.used, false)
        )
      )
      .limit(1);

    // Mark the pre-key as used
    if (oneTimePreKey) {
      await db
        .update(e2eOneTimePreKeys)
        .set({ used: true })
        .where(eq(e2eOneTimePreKeys.id, oneTimePreKey.id));
    }

    res.json({
      success: true,
      bundle: {
        identityKey: bundle.identityKey,
        signedPreKey: bundle.signedPreKey,
        signedPreKeyId: bundle.signedPreKeyId,
        signedPreKeySignature: bundle.signedPreKeySignature,
        registrationId: bundle.registrationId,
        oneTimePreKey: oneTimePreKey
          ? { keyId: oneTimePreKey.keyId, publicKey: oneTimePreKey.publicKey }
          : null,
      },
    });
  } catch (error) {
    console.error('Get key bundle error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get key bundle',
    });
  }
});

// Get count of remaining one-time pre-keys
router.get('/keys/prekeys/count', async (req: AuthenticatedRequest, res) => {
  try {
    const myAgentId = req.agent!.id;

    const [result] = await db
      .select({ count: e2eOneTimePreKeys.id })
      .from(e2eOneTimePreKeys)
      .where(
        and(
          eq(e2eOneTimePreKeys.agentId, myAgentId),
          eq(e2eOneTimePreKeys.used, false)
        )
      );

    // Count manually since SQL count aggregation is complex with Drizzle
    const unused = await db
      .select()
      .from(e2eOneTimePreKeys)
      .where(
        and(
          eq(e2eOneTimePreKeys.agentId, myAgentId),
          eq(e2eOneTimePreKeys.used, false)
        )
      );

    res.json({
      success: true,
      count: unused.length,
    });
  } catch (error) {
    console.error('Get pre-key count error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get pre-key count',
    });
  }
});

// Send an encrypted DM
router.post('/dm/:agentId', async (req: AuthenticatedRequest, res) => {
  try {
    const { agentId: targetAgentId } = req.params;
    const { ciphertext, senderKeyId } = req.body;
    const myAgentId = req.agent!.id;

    if (!ciphertext) {
      return res.status(400).json({
        success: false,
        error: 'Ciphertext is required',
      });
    }

    // Check if target agent exists
    const [targetAgent] = await db
      .select({ id: agents.id, name: agents.name, handle: agents.handle })
      .from(agents)
      .where(eq(agents.id, targetAgentId))
      .limit(1);

    if (!targetAgent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }

    // Can't DM yourself
    if (targetAgentId === myAgentId) {
      return res.status(400).json({
        success: false,
        error: 'Cannot send DM to yourself',
      });
    }

    // Create encrypted DM
    const [newDm] = await db
      .insert(directMessages)
      .values({
        fromAgentId: myAgentId,
        toAgentId: targetAgentId,
        content: '[Encrypted message]', // Placeholder for unencrypted content field
        encrypted: true,
        ciphertext,
        senderKeyId,
      })
      .returning();

    const dmWithAgent = {
      ...newDm,
      from: req.agent,
      to: targetAgent,
    };

    // Emit socket event to recipient
    const io = req.app.get('io');
    io.to(`agent:${targetAgentId}`).emit('dm:encrypted', dmWithAgent);

    res.status(201).json({
      success: true,
      message: dmWithAgent,
    });
  } catch (error) {
    console.error('Send encrypted DM error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send encrypted message',
    });
  }
});

export { router as e2eRouter };
