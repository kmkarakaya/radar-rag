# How retrieval-augmented generation (RAG) works

Retrieval-augmented generation answers questions from your own documents. It has two phases: indexing, which happens once per document set, and retrieval, which happens for every question.

## Indexing

1. Loading: every supported file in the collection's source folder is read and turned into plain text.
2. Chunking: the text is split into chunks, small overlapping pieces of text. A chunk is the unit that is searched and returned. The chunk size (500 characters by default) and the overlap between neighbouring chunks (200 characters by default) are collection settings. Smaller chunks give more precise matches; larger chunks keep more context together.
3. Embedding: an embedding model turns each chunk into a vector, a list of numbers that captures its meaning. Texts with similar meaning get vectors that are close to each other.
4. Storing: the vectors and their chunks are stored in a vector database (Chroma).

## Retrieval

1. The question is turned into a vector with the same embedding model.
2. The vector database finds the chunks whose vectors are closest to the question's vector.
3. Each result comes with a distance. A smaller distance means a closer match. Results above the collection's distance threshold are dropped, so unrelated text is not returned.

The closest chunks, with their source file names and distances, are the retrieval result. Your application can show them as evidence or pass them to a language model.

## Generation (optional)

To produce a written answer, the retrieved chunks are put into a prompt together with the question and sent to a chat model. The model is instructed to answer only from that context and to say so when the context does not contain the answer. This grounding is what makes RAG answers traceable to their sources.

## Why the embedding model matters

A collection must be searched with the same embedding model it was indexed with, because vectors from different models are not comparable. That is why changing a collection's embedding model requires a re-index.
