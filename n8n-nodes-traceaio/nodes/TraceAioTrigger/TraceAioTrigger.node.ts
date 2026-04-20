import {
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
	INodeExecutionData,
} from 'n8n-workflow';

export class TraceAioTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'TraceAIO Trigger',
		name: 'traceAioTrigger',
		icon: 'file:traceaio-favicon.png',
		group: ['trigger'],
		version: 1,
		subtitle: 'On analysis complete',
		description: 'Triggers when a TraceAIO analysis run completes',
		defaults: {
			name: 'On analysis complete',
		},
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'traceAioApi',
				required: true,
			},
		],
		polling: true,
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Analysis Complete', value: 'analysisComplete', description: 'Triggers when an analysis run finishes' },
				],
				default: 'analysisComplete',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const credentials = await this.getCredentials('traceAioApi');
		const baseUrl = (credentials.baseUrl as string).replace(/\/$/, '');
		const apiKey = credentials.apiKey as string;

		const pollData = this.getWorkflowStaticData('node');
		const isManual = this.getMode() === 'manual';
		const lastCompletedAt = pollData.lastCompletedAt as string | undefined;

		// On first run in production, default to now so we don't fire on historical runs.
		// In manual/test mode, fetch the most recent run so there's something to show.
		if (!lastCompletedAt && !isManual) {
			pollData.lastCompletedAt = new Date().toISOString();
			return null;
		}

		const since = lastCompletedAt || new Date(0).toISOString();
		const url = `${baseUrl}/api/analysis/runs?from=${encodeURIComponent(since)}`;

		const response = await this.helpers.httpRequest({
			method: 'GET',
			url,
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
			json: true,
		});

		const runs = response as Array<{
			id: number;
			startedAt: string;
			completedAt: string | null;
			status: string;
			brandName: string | null;
			totalPrompts: number;
			completedPrompts: number;
			responseCount: number;
		}>;

		// Filter to runs completed after our last check
		const newRuns = runs.filter(
			(r) => r.completedAt && new Date(r.completedAt) > new Date(since),
		);

		if (newRuns.length === 0) {
			return null;
		}

		// Update state to the most recent completedAt
		const mostRecent = newRuns.reduce((latest, r) =>
			new Date(r.completedAt!) > new Date(latest.completedAt!) ? r : latest,
		);
		pollData.lastCompletedAt = mostRecent.completedAt;

		// Fetch metrics for each new run
		const items: INodeExecutionData[] = [];
		for (const run of newRuns) {
			let metrics = {};
			try {
				metrics = await this.helpers.httpRequest({
					method: 'GET',
					url: `${baseUrl}/api/metrics?runId=${run.id}`,
					headers: { Authorization: `Bearer ${apiKey}` },
					json: true,
				});
			} catch {}

			items.push({
				json: {
					runId: run.id,
					status: run.status,
					brandName: run.brandName,
					startedAt: run.startedAt,
					completedAt: run.completedAt,
					totalPrompts: run.totalPrompts,
					completedPrompts: run.completedPrompts,
					responseCount: run.responseCount,
					...(metrics as Record<string, unknown>),
				},
			});
		}

		return [items];
	}
}
