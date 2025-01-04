// *****************************************************************************
// Copyright (C) 2025 EclipseSource GmbH.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QuickInputService, URI } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FileQuickPickItem, QuickFileSelectService } from '@theia/file-search/lib/browser/quick-file-select-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import {
    AIVariable,
    AIVariableContext,
    AIVariableContribution,
    AIVariableResolutionRequest,
    AIVariableResolver,
    AIVariableService,
    ResolvedAIVariable
} from '../common/variable-service';

export namespace FileVariableArgs {
    export const uri = 'uri';
}

export const FILE_VARIABLE: AIVariable = {
    id: 'file-provider',
    description: 'Resolves the contents of a file',
    name: 'file',
    args: [{ name: FileVariableArgs.uri, description: 'The URI of the requested file.' }]
};

@injectable()
export class FileVariableContribution implements AIVariableContribution, AIVariableResolver {
    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly wsService: WorkspaceService;

    @inject(QuickInputService)
    protected readonly quickInputService: QuickInputService;

    @inject(QuickFileSelectService)
    protected readonly quickFileSelectService: QuickFileSelectService;

    registerVariables(service: AIVariableService): void {
        service.registerResolver(FILE_VARIABLE, this);
        service.registerArgumentPicker(FILE_VARIABLE, async _ => {
            const quickPick = this.quickInputService.createQuickPick();
            quickPick.items = await this.quickFileSelectService.getPicks();
            const onChangeListener = quickPick.onDidChangeValue(async value => {
                quickPick.items = await this.quickFileSelectService.getPicks(value);
            });
            quickPick.show();
            return new Promise<string | undefined>(resolve => {
                quickPick.onDispose(() => {
                    onChangeListener.dispose();
                });
                quickPick.onDidAccept(() => {
                    const item = quickPick.selectedItems[0];
                    if (item && FileQuickPickItem.is(item)) {
                        quickPick.dispose();
                        resolve(item.uri.toString());
                    }
                });
            });
        });
    }

    async canResolve(request: AIVariableResolutionRequest, _: AIVariableContext): Promise<number> {
        return request.variable.name === FILE_VARIABLE.name ? 1 : 0;
    }

    async resolve(request: AIVariableResolutionRequest, _: AIVariableContext): Promise<ResolvedAIVariable | undefined> {
        const uri = new URI(request.arg);
        if (request.variable.name === FILE_VARIABLE.name && await this.fileService.exists(uri)) {
            const content = await this.fileService.readFile(uri);
            return {
                variable: request.variable,
                value: await this.getWorkspaceRelatePath(uri),
                contextValue: content.value.toString()
            };
        }
        return undefined;
    }

    protected async getWorkspaceRelatePath(uri: URI): Promise<string> {
        const wsUri = this.wsService.getWorkspaceRootUri(uri);
        if (wsUri) {
            const wsRelative = wsUri.relative(uri);
            if (wsRelative) {
                return wsRelative.toString();
            }
        }
        return uri.path.fsPath();
    }
}
