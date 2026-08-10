export namespace main {
	
	export class FileEntry {
	    name: string;
	    path: string;
	    isDir: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	    }
	}
	export class Settings {
	    rootDir: string;
	    windowMaximized: boolean;
	    openTabPaths: string[];
	    activeTabPath: string;
	    language: string;
	    outlineAutoNumber: boolean;
	    grammarCheckEnabled: boolean;
	    customDictionary: string[];
	    syncEnabled: boolean;
	    syncURL: string;
	    syncUsername: string;
	    syncPassword: string;
	    syncIntervalMinutes: number;
	    syncVerified: boolean;
	    lastSyncTime: string;
	    lastSyncError: string;
	    lastUpdateCheckDate: string;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rootDir = source["rootDir"];
	        this.windowMaximized = source["windowMaximized"];
	        this.openTabPaths = source["openTabPaths"];
	        this.activeTabPath = source["activeTabPath"];
	        this.language = source["language"];
	        this.outlineAutoNumber = source["outlineAutoNumber"];
	        this.grammarCheckEnabled = source["grammarCheckEnabled"];
	        this.customDictionary = source["customDictionary"];
	        this.syncEnabled = source["syncEnabled"];
	        this.syncURL = source["syncURL"];
	        this.syncUsername = source["syncUsername"];
	        this.syncPassword = source["syncPassword"];
	        this.syncIntervalMinutes = source["syncIntervalMinutes"];
	        this.syncVerified = source["syncVerified"];
	        this.lastSyncTime = source["lastSyncTime"];
	        this.lastSyncError = source["lastSyncError"];
	        this.lastUpdateCheckDate = source["lastUpdateCheckDate"];
	    }
	}
	export class SyncResult {
	    success: boolean;
	    message: string;
	    filesSynced: number;
	    errors: string[];
	
	    static createFrom(source: any = {}) {
	        return new SyncResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.message = source["message"];
	        this.filesSynced = source["filesSynced"];
	        this.errors = source["errors"];
	    }
	}
	export class SyncStatus {
	    enabled: boolean;
	    configured: boolean;
	    syncing: boolean;
	    lastSyncTime: string;
	    lastError: string;
	    filesSynced: number;
	
	    static createFrom(source: any = {}) {
	        return new SyncStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.configured = source["configured"];
	        this.syncing = source["syncing"];
	        this.lastSyncTime = source["lastSyncTime"];
	        this.lastError = source["lastError"];
	        this.filesSynced = source["filesSynced"];
	    }
	}
	export class UpdateStatus {
	    ready: boolean;
	    version: string;

	    static createFrom(source: any = {}) {
	        return new UpdateStatus(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ready = source["ready"];
	        this.version = source["version"];
	    }
	}

}
