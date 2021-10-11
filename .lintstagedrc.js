const path = require('path');

const prettierSupportInfo = require('prettier').getSupportInfo();
const eslintCli = new (require('eslint').ESLint)({});

/** @type {readonly string[]} */
const prettierSupportedExt = prettierSupportInfo.languages.reduce((arr, l) => {
    if (l.extensions) arr.push(...l.extensions);
    return arr;
}, []);
/** @type {readonly string[]} */
const prettierSupportedFilename = prettierSupportInfo.languages.reduce((arr, l) => {
    if (l.filenames) arr.push(...l.filenames);
    return arr;
}, []);

/**
 * @param {string} f
 */
const isEslintFile = async (f) => {
    const ext = path.extname(f);
    if (!ext || !['.js', '.jsx', '.ts', '.tsx', '.vue'].includes(ext)) return false;
    return !(await eslintCli.isPathIgnored(f));
};

const isStylelintFile = (() => {
    try {
        require.resolve('stylelint');
        /**
         * @param {string} f
         */
        return (f) => {
            const ext = path.extname(f);
            if (!ext || !['.css', '.scss', '.sass'].includes(ext)) return false;
            return true;
        };
    } catch {
        return () => false;
    }
})();

/**
 * @param {string[]} files
 * @param {string[]} commands
 */
function makeCommands(files, commands) {
    if (files.length === 0) return [];
    const fileLine = ` -- '${files.join(`' '`)}'`;
    return commands.map((c) => c + fileLine);
}
/**
 * @param {(files: string[]) => (string[] | Promise<string[]>)} impl
 * @returns {(files: string[]) => Promise<string[]>}
 */
function handler(impl) {
    return async (files) => {
        console.log('files: ', files);
        try {
            const commands = await impl(files);
            console.log('commands: ', commands);
            return commands;
        } catch (error) {
            console.error(error);
            throw error;
        }
    };
}

module.exports = {
    /**
     * @param {string[]} files
     */
    '*': handler(async (files) => {
        const commands = [];
        const eslintFiles = [];
        const stylelintFiles = [];
        const prettierFiles = [];
        for (const file of files) {
            if (await isEslintFile(file)) {
                eslintFiles.push(file);
            } else if (isStylelintFile(file)) {
                stylelintFiles.push(file);
            } else {
                const filename = path.basename(file);
                if (
                    prettierSupportedFilename.includes(filename) ||
                    prettierSupportedExt.some((v) => filename.endsWith(v))
                ) {
                    prettierFiles.push(file);
                }
            }
        }
        commands.push(
            ...makeCommands(eslintFiles, [`eslint --fix --max-warnings 0 --no-error-on-unmatched-pattern`, `git add`]),
            ...makeCommands(stylelintFiles, [`stylelint --fix`, `git add`]),
            ...makeCommands(prettierFiles, [`prettier --write`, `git add`]),
        );
        return commands;
    }),
};
