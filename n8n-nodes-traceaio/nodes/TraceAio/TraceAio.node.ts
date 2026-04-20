import {
	IExecuteFunctions,
	INodeType,
	INodeTypeDescription,
	INodeExecutionData,
} from 'n8n-workflow';

export class TraceAio implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'TraceAIO',
		name: 'traceAio',
		icon: 'file:traceaio-favicon.png',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with TraceAIO brand tracking API',
		defaults: {
			name: 'TraceAIO',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'traceAioApi',
				required: true,
			},
		],
		properties: [
			// Resource
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Analysis', value: 'analysis' },
					{ name: 'Competitors', value: 'competitors' },
					{ name: 'Metrics', value: 'metrics' },
					{ name: 'Sources', value: 'sources' },
				],
				default: 'metrics',
			},

			// --- Metrics operations ---
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['metrics'] } },
				options: [
					{ name: 'Get', value: 'get', description: 'Get brand mention rate, top competitor, source counts', action: 'Get metrics' },
					{ name: 'Get By Model', value: 'getByModel', description: 'Get per-model mention rates', action: 'Get metrics by model' },
					{ name: 'Get Visibility Score', value: 'getVisibility', description: 'Get brand visibility score', action: 'Get visibility score' },
				],
				default: 'get',
			},

			// --- Competitors operations ---
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['competitors'] } },
				options: [
					{ name: 'Get All', value: 'getAll', description: 'Get competitor ranking with mention rates', action: 'Get all competitors' },
				],
				default: 'getAll',
			},

			// --- Sources operations ---
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['sources'] } },
				options: [
					{ name: 'Get All', value: 'getAll', description: 'Get source domains with citation counts', action: 'Get all sources' },
				],
				default: 'getAll',
			},

			// --- Analysis operations ---
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['analysis'] } },
				options: [
					{ name: 'Start', value: 'start', description: 'Start a new analysis run', action: 'Start analysis' },
				],
				default: 'start',
			},

			// --- Shared parameters ---
			{
				displayName: 'Run ID',
				name: 'runId',
				type: 'number',
				default: '',
				description: 'Analysis run ID. Leave empty for aggregate across all runs. When chained after the trigger, use expression: {{ $json.runId }}',
				displayOptions: {
					show: {
						resource: ['metrics', 'competitors', 'sources'],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const credentials = await this.getCredentials('traceAioApi');
		const baseUrl = (credentials.baseUrl as string).replace(/\/$/, '');
		const apiKey = credentials.apiKey as string;

		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		const headers = { Authorization: `Bearer ${apiKey}` };

		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			let url = '';
			let method = 'GET';
			const runId = resource !== 'analysis'
				? (this.getNodeParameter('runId', i, 0) as number)
				: 0;
			const runParam = runId ? `?runId=${runId}` : '';

			if (resource === 'metrics') {
				if (operation === 'get') {
					url = `${baseUrl}/api/metrics${runParam}`;
				} else if (operation === 'getByModel') {
					url = `${baseUrl}/api/metrics/by-model${runParam}`;
				} else if (operation === 'getVisibility') {
					url = `${baseUrl}/api/metrics/visibility-score${runParam}`;
				}
			} else if (resource === 'competitors') {
				url = `${baseUrl}/api/competitors/analysis${runParam}`;
			} else if (resource === 'sources') {
				url = `${baseUrl}/api/sources/analysis${runParam}`;
			} else if (resource === 'analysis' && operation === 'start') {
				url = `${baseUrl}/api/analysis/start`;
				method = 'POST';
			}

			const response = await this.helpers.httpRequest({
				method: method as 'GET' | 'POST',
				url,
				headers,
				json: true,
			});

			if (Array.isArray(response)) {
				returnData.push({
					json: {
						runId: runId || undefined,
						count: response.length,
						items: response,
					},
				});
			} else {
				returnData.push({ json: { runId: runId || undefined, ...response } });
			}
		}

		return [returnData];
	}
}
