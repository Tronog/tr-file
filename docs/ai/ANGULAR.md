Use clean enterprise development methods.
Components must not contain business logic.
Business logic is contained in component services.
Services must be as thin as possible. They should contain only the common state.
All functionalities should be contained in feature classes.
All state of the feature should be contained in a feature class.
Each service class and feature class must be in its own files.

Here is an example:
```typescript
export class ExampleService {
    someProp: any;
    ...
    private dataFt = new dataFeature(this);
    ...
}

export class DataFeature {
    private privateData: any;

    constructor(private parent: ExampleService) {
        ...
    }

    public function doStuff() {
        this.parent.someProp = '';
        this.privateData = 0;
    }
}
```
