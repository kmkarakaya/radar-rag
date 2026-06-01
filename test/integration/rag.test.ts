import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { retrieveSources, RagQueryError, checkChromaHealth } from "../../src/rag.js";
import { config } from "../../src/config.js";
import { createPhysicalChromaCollection, deletePhysicalChromaCollection } from "../../src/collections/chromaCollections.js";
import { randomUUID } from "node:crypto";

describe("rag core", () => {
  it("does not create a collection during read path if it is missing", async () => {
    const missingCollectionName = `test_missing_${randomUUID()}`;
    
    // Attempting to answer a question or retrieve from a missing collection should fail
    // rather than accidentally calling getOrCreateCollection which creates it.
    try {
      // retrieveSources itself doesn't check if it's readable in this iteration unless we mock it,
      // wait, the prompt says "RAG route'ları daha sonra assertChromaCollectionReadable çağıracak; 
      // bu promptta helper hazır olsun. Unit test ile missing collection için LangChain 
      // getOrCreateCollection çağrılmadığını kanıtla."
      
      // Let's call retrieveSources directly. LangChain Chroma wrapper does NOT call getOrCreateCollection 
      // when we only use similaritySearch if it doesn't exist? Wait, actually if collection is missing, 
      // Chroma client throws a "not found" error. LangChain's Chroma.fromTexts calls getOrCreateCollection. 
      // Our createVectorStore doesn't call it. It just passes the collectionName.
      await retrieveSources("test question", { 
        collectionName: missingCollectionName, 
        runtimeConfig: config 
      });
      assert.fail("Should have thrown an error");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /not found|does not exist|404|could not be found/i);
    }
    
    // Now verify the collection was NOT created by attempting to assert readability, which should fail.
    const health = await checkChromaHealth(config, { collectionName: missingCollectionName });
    assert.equal(health.details?.collectionReadable, false);
  });
});
