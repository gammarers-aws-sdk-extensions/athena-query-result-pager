import { ProjenTypeScriptProject } from '@gammarers/projen-projects';
const project = new ProjenTypeScriptProject({
  name: 'athena-query-result-pager',
  repositoryUrl: 'https://github.com/gammarers-aws-sdk-extensions/athena-query-result-pager.git',
  description: 'Paginate AWS Athena GetQueryResults calls with AWS SDK v3. This library walks NextToken, parses tabular rows with athena-query-result-parser, and forwards MaxResults and QueryResultType from PagerOptions on every GetQueryResults request.',
  keywords: [
    'aws', 'aws-sdk', 'athena', 'query', 'result', 'pager',
  ],
  deps: [
    '@aws-sdk/client-athena@^3.983.0',
    'athena-query-result-parser@^0.7.0',
  ],
  devDeps: [
    '@gammarers/projen-projects@^0.5.8',
  ],
  releaseToNpm: true,
  npmTrustedPublishing: true,
});
project.synth();