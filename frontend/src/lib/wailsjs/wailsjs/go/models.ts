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
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rootDir = source["rootDir"];
	        this.windowMaximized = source["windowMaximized"];
	        this.openTabPaths = source["openTabPaths"];
	        this.activeTabPath = source["activeTabPath"];
	    }
	}

}

