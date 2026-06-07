import { describe, expect, it } from 'vitest';

import {
  GetterPropType,
  OutputHttpClient,
  Verbs,
  type GeneratorOptions,
  type GeneratorVerbOptions,
} from '@orval/core';

import {
  generateMutationHook,
  getMutationOptionsPathParamNames,
  getMutationOptionsUrl,
} from './mutation-generator';
import { createFrameworkAdapter } from './frameworks';

describe('getMutationOptionsUrl', () => {
  it('keeps static routes unchanged', () => {
    expect(getMutationOptionsUrl('/pets', [])).toBe('/pets');
  });

  it('converts path params to route-pattern placeholders', () => {
    expect(getMutationOptionsUrl('/pets/${petId}', ['petId'])).toBe(
      '/pets/{petId}',
    );
  });

  it('converts embedded path params without referencing scoped variables', () => {
    expect(
      getMutationOptionsUrl('/api/v${version}/entity/${entityId}', [
        'version',
        'entityId',
      ]),
    ).toBe('/api/v{version}/entity/{entityId}');
  });

  it('keeps runtime baseUrl expressions intact', () => {
    expect(
      getMutationOptionsUrl('${getBaseUrl()}/api/v${version}', ['version']),
    ).toBe('${getBaseUrl()}/api/v{version}');
  });

  it('only converts path params in the route suffix when a path route is provided', () => {
    expect(
      getMutationOptionsUrl(
        '${version}/api/v${version}/entity/${entityId}',
        ['version', 'entityId'],
        '/api/v${version}/entity/${entityId}',
      ),
    ).toBe('${version}/api/v{version}/entity/{entityId}');
  });

  it('handles base URLs that remove the path route leading slash', () => {
    expect(
      getMutationOptionsUrl(
        '${getBaseUrl()}api/v${version}/entity/${entityId}',
        ['version', 'entityId'],
        '/api/v${version}/entity/${entityId}',
      ),
    ).toBe('${getBaseUrl()}api/v{version}/entity/{entityId}');
  });

  it('keeps non-path template expressions intact', () => {
    expect(
      getMutationOptionsUrl('/api/${tenant}/entity/${entityId}', ['entityId']),
    ).toBe('/api/${tenant}/entity/{entityId}');
  });
});

describe('getMutationOptionsPathParamNames', () => {
  it('extracts names from destructured named path params', () => {
    expect(
      getMutationOptionsPathParamNames([
        {
          type: GetterPropType.PARAM,
          name: 'petId',
          definition: 'petId: string',
          implementation: 'petId',
          default: undefined,
          required: true,
        },
        {
          type: GetterPropType.NAMED_PATH_PARAMS,
          name: 'params',
          definition: 'params: PathParams',
          implementation:
            '{ version = 1, entityId: entity, ...rest, tenantId }',
          default: false,
          required: true,
          destructured: '{ version = 1, entityId: entity, ...rest, tenantId }',
          schema: {
            name: 'PathParams',
            model: '',
            imports: [],
          },
        },
      ]),
    ).toEqual(['petId', 'version', 'entityId', 'tenantId']);
  });
});

describe('generateMutationHook invalidation', () => {
  const createOptions = (
    baseUrl?: GeneratorOptions['context']['output']['baseUrl'],
  ): GeneratorOptions =>
    ({
      route: `${typeof baseUrl === 'string' ? baseUrl : ''}/api/v1/friends/\${friendId}`,
      pathRoute: '/api/v1/friends/${friendId}',
      output: '',
      override: {
        fetch: { forceSuccessResponse: false, useRuntimeFetcher: false },
        query: {
          mutationInvalidates: [
            {
              onMutations: ['removeFriend'],
              invalidates: [
                { query: 'getFriendGroup', invalidateMode: 'reset' },
              ],
            },
          ],
          shouldSplitQueryKey: false,
          useOperationIdAsQueryKey: false,
        },
      },
      context: {
        workspace: '',
        output: {
          target: '',
          httpClient: OutputHttpClient.FETCH,
          baseUrl,
        },
        spec: {
          openapi: '3.1.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            '/api/v1/friend-groups/{friend_group_id}': {
              get: {
                operationId: 'get_friend_group',
                parameters: [
                  {
                    name: 'friend_group_id',
                    in: 'path',
                    required: true,
                    schema: { type: 'integer' },
                  },
                ],
              },
            },
          },
        },
      },
    }) as unknown as GeneratorOptions;

  const createVerbOptions = (
    shouldSplitQueryKey = false,
  ): GeneratorVerbOptions =>
    ({
      verb: Verbs.DELETE,
      route: '/api/v1/friends/${friendId}',
      pathRoute: '/api/v1/friends/{friend_id}',
      operationId: 'remove_friend',
      operationName: 'removeFriend',
      doc: '',
      tags: [],
      response: {
        definition: { success: 'void', errors: 'unknown' },
        imports: [],
        schemas: [],
      },
      body: {
        definition: '',
        implementation: '',
        imports: [],
        schemas: [],
        isOptional: false,
      },
      params: [],
      props: [],
      override: {
        fetch: { forceSuccessResponse: false, useRuntimeFetcher: false },
        query: {
          mutationInvalidates: [
            {
              onMutations: ['removeFriend'],
              invalidates: [
                { query: 'getFriendGroup', invalidateMode: 'reset' },
              ],
            },
          ],
          shouldSplitQueryKey,
          useOperationIdAsQueryKey: false,
        },
      },
      originalOperation: {},
    }) as unknown as GeneratorVerbOptions;

  const generateImplementation = async (
    baseUrl?: GeneratorOptions['context']['output']['baseUrl'],
    shouldSplitQueryKey = false,
  ) => {
    const { implementation } = await generateMutationHook({
      verbOptions: createVerbOptions(shouldSplitQueryKey),
      options: createOptions(baseUrl),
      isRequestOptions: false,
      httpClient: OutputHttpClient.FETCH,
      doc: '',
      adapter: createFrameworkAdapter({
        outputClient: 'react-query',
        queryVersion: 5,
      }),
    });

    return implementation;
  };

  it('matches broad invalidation prefixes against constant baseUrl query keys', async () => {
    const implementation = await generateImplementation(
      'https://api.example.com',
    );

    expect(implementation).toContain(
      "query.queryKey[0].startsWith('https://api.example.com/api/v1/friend-groups/')",
    );
  });

  it('matches broad invalidation prefixes against constant object baseUrl query keys', async () => {
    const implementation = await generateImplementation({
      getBaseUrlFromSpecification: false,
      baseUrl: 'https://api.example.com',
    });

    expect(implementation).toContain(
      "query.queryKey[0].startsWith('https://api.example.com/api/v1/friend-groups/')",
    );
  });

  it('does not emit runtime baseUrl expressions in broad invalidation prefixes', async () => {
    const implementation = await generateImplementation({
      runtime: 'getBaseUrl()',
    });

    expect(implementation).toContain(
      "query.queryKey[0].startsWith('/api/v1/friend-groups/')",
    );
    expect(implementation).not.toContain('${getBaseUrl()}');
  });

  it('includes constant baseUrl segments in split query key broad invalidation', async () => {
    const implementation = await generateImplementation(
      'https://api.example.com',
      true,
    );

    expect(implementation).toContain(
      "queryClient.resetQueries({ queryKey: ['https:', 'api.example.com', 'api', 'v1', 'friend-groups'] });",
    );
  });
});
