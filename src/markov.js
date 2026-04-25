/**
 * Tiny Deterministic Markov Chain Generator
 */

/**
 * Builds a transition matrix from an array of sentences.
 */
export const buildMatrix = (corpus) => {
    const matrix = {};
    corpus.forEach(sentence => {
        const words = sentence.split(/\s+/);
        for (let i = 0; i < words.length; i++) {
            const current = words[i];
            const next = words[i + 1] || null; // null represents end of sentence
            if (!matrix[current]) matrix[current] = [];
            matrix[current].push(next);
        }
    });
    return matrix;
};

/**
 * Generates a sentence from a corpus using a seeded RNG.
 */
export const generateSentence = (corpus, rng, maxWords = 15) => {
    if (!corpus || corpus.length === 0) return "";
    const matrix = buildMatrix(corpus);

    // Pick a starting word that is the first word of some sentence in the corpus
    const starts = corpus.map(s => s.split(/\s+/)[0]);
    let current = starts[rng(starts.length)];
    const result = [current];

    for (let i = 0; i < maxWords - 1; i++) {
        const possibilities = matrix[current];
        if (!possibilities || possibilities.length === 0) break;
        
        const next = possibilities[rng(possibilities.length)];
        if (next === null) break;
        
        result.push(next);
        current = next;
    }

    return result.join(' ');
};
