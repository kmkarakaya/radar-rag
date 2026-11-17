# What is Radar RAG?

Radar RAG is a self-hosted, LLM-agnostic retrieval server that finds the evidence in your documents. You give it a folder of documents; it indexes them, and your application, script or AI assistant asks it for the passages that are most relevant to a question.

It is LLM-agnostic: retrieval does not need a chat model. Your application receives the relevant passages and passes them to whichever large language model you prefer. Generating a written answer inside Radar RAG is optional; it works with any OpenAI-compatible chat API (a local Ollama, OpenAI, OpenRouter, LM Studio, vLLM).

## What you get

- Collections: each collection is a set of documents from one source folder, indexed with its own settings.
- A public HTTP API under /v1/rag to list collections, check readiness and retrieve passages.
- An admin panel at /admin to create collections, start re-indexing and try searches in the Playground.
- A built-in embedding model that runs on the CPU, so no external service is needed to get started.

## Who it is for

- Developers who build their own chatbot or internal tool and want retrieval over their own documents.
- People who connect documents to an AI assistant or agent.
- Learners who want a small, readable reference implementation of retrieval-augmented generation (RAG).

The sample documents you are reading are indexed automatically on the first start, so you can try a search right away. Try asking "What is a chunk?" or "Which file formats can I index?".
