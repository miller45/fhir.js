var typeDefinitions = require('./profiles/types.json');
var valueSets = require('./profiles/valuesets.json');
var _ = require('underscore');

/**
 * @typedef {Object} ValidationResponse
 * @property {boolean} valid Indicates if errors were encountered during validation
 * @property {ValidationMessage[]} messages Warning and error messages from validation
 */

/**
 * @typedef {Object} ValidationMessage
 * @property {string} location The location of where the error occurred
 * @property {string} severity The severity of the message (fatal | error | warning)
 * @property {string} message The message
 * @property {string} resourceId The id of the resource the message relates to
 */

/**
 * @typedef {Object} ValidationOptions
 * @property {boolean} errorOnUnexpected Indicates if an error should be returned when an unexpected property is encountered
 */

module.exports = function(objOrXml, options) {
    var obj = objOrXml;
    var isXml = false;

    if (typeof(objOrXml) === 'string') {
        var ConvertToJS = require('./convertToJs');
        var convertToJS = new ConvertToJS();
        obj = convertToJS.convert(objOrXml);
        isXml = true;
    }

    var validation = new FhirValidation(options);
    return validation.validate(obj, isXml);
}

var SEVERITY_FATAL = 'fatal';
var SEVERITY_ERROR = 'error';
var SEVERITY_WARN = 'warning';
var SEVERITY_INFO = 'info';
var PRIMITIVE_TYPES = ['instant','time','date','dateTime','decimal','boolean','integer','base64Binary','string','uri','unsignedInt','positiveInt','code','id','oid','markdown','Element'];
var DATA_TYPES = ['Reference','Narrative', 'Ratio','Period','Range','Attachment','Identifier','HumanName','Annotation','Address','ContactPoint','SampledData','Quantity','CodeableConcept','Signature','Coding','Timing','Age','Distance','SimpleQuantity','Duration','Count','Money'];
var PRIMITIVE_NUMBER_TYPES = ['unsignedInt','positiveInt','decimal','integer'];
var PRIMITIVE_DATE_REGEX = /([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1]))?)?/i;
var PRIMITIVE_DATETIME_REGEX = /([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1])(T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00)))?)?)?/i;
var PRIMITIVE_TIME_REGEX = /([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?/i;
var PRIMITIVE_CODE_REGEX = /[^\s]+(\s[^\s]+)*/i;
var PRIMITIVE_OID_REGEX = /urn:oid:[0-2](\.[1-9]\d*)+/i;
var PRIMITIVE_ID_REGEX = /[A-Za-z0-9\-\.]{1,64}/i;
var PRIMITIVE_POSITIVE_INT_REGEX = /^(?!0+$)\d+$/i;
var PRIMITIVE_UNSIGNED_INT_REGEX = /[0]|([1-9][0-9]*)/i;
var PRIMITIVE_INTEGER_REGEX = /[0]|[-+]?[1-9][0-9]*/i;
var PRIMITIVE_DECIMAL_REGEX = /-?([0]|([1-9][0-9]*))(\.[0-9]+)?/i;

function getTreeDisplay(tree, isXml, leaf) {
    var display = '';

    for (var i = 0; i < tree.length; i++) {
        if (display) {
            if (isXml) {
                display += '/';
            } else {
                display += '.';
            }
        }

        display += tree[i];
    }

    if (leaf) {
        if (display) {
            if (isXml) {
                display += '/';
            } else {
                display += '.';
            }
        }

        display += leaf;
    }

    return display;
}

function checkCode(valueSet, code, system) {
    if (system) {
        var foundSystem = _.find(valueSet.systems, function(nextSystem) {
            return nextSystem.uri === system;
        });

        if (foundSystem) {
            var foundCode = _.find(foundSystem.codes, function(nextCode) {
                return nextCode.code === code;
            });

            return !!foundCode;
        } else {
            return false;
        }
    } else {
        var valid = false;

        _.each(valueSet.systems, function(nextSystem) {
            var foundCode = _.find(nextSystem.codes, function(nextCode) {
                return nextCode.code === code;
            });

            if (foundCode) {
                valid = true;
            }
        })

        return valid;
    }
}

var FhirInstanceValidation = function(options, resourceId, isXml) {
    this.options = options;
    this.response = {
        valid: true,
        messages: []
    };
    this.isXml = isXml;
    this.resourceId = resourceId;
};

FhirInstanceValidation.prototype.getResponse = function() {
    return this.response;
};

FhirInstanceValidation.prototype.addError = function(location, message) {
    this.response.valid = false;
    this.response.messages.push({
        location: location,
        resourceId: this.resourceId,
        severity: SEVERITY_ERROR,
        message: message
    });
};

FhirInstanceValidation.prototype.addFatal = function(location, message) {
    this.response.valid = false;
    this.response.messages.push({
        location: location,
        resourceId: this.resourceId,
        severity: SEVERITY_FATAL,
        message: message
    });
};

FhirInstanceValidation.prototype.addWarn = function(location, message) {
    this.response.messages.push({
        location: location,
        resourceId: this.resourceId,
        severity: SEVERITY_WARN,
        message: message
    });
};

FhirInstanceValidation.prototype.addInfo = function(location, message) {
    this.response.messages.push({
        location: location,
        resourceId: this.resourceId,
        severity: SEVERITY_INFO,
        message: message
    });
};

FhirInstanceValidation.prototype.validateNext = function(obj, property, tree) {
    var self = this;
    var treeDisplay = getTreeDisplay(tree, this.isXml);

    if (property._valueSet) {
        var foundValueSet = _.find(valueSets, function(valueSet, valueSetKey) {
            return valueSetKey === property._valueSet;
        });

        if (!foundValueSet) {
            self.addInfo(treeDisplay, 'Value set "' + property._valueSet + '" could not be found.');
        } else {
            if (property._type === 'CodeableConcept') {
                var found = false;

                _.each(obj.coding, function (coding) {
                    if (checkCode(foundValueSet, coding.code, coding.system)) {
                        found = true;
                    } else {
                        var msg = 'Code "' + coding.code + '" ' + (coding.system ? '(' + coding.system + ')' : '') + ' not found in value set';
                        if (property._valueSetStrength === 'required') {
                            self.addError(treeDisplay, msg);
                        } else {
                            self.addWarn(treeDisplay, msg);
                        }
                    }
                });

                if (!found) {
                    // TODO: If the CodeableConcept is required, does that mean a coding is required? Don't think so...
                }
            } else if (property._type === 'Coding') {
                if (!checkCode(foundValueSet, obj.code, obj.system)) {
                    var msg = 'Code "' + obj.code + '" ' + (obj.system ? '(' + obj.system + ')' : '') + ' not found in value set';
                    if (property._valueSetStrength === 'required') {
                        this.addError(treeDisplay, msg);
                    } else {
                        this.addWarn(treeDisplay, msg);
                    }
                }
            } else if (property._type === 'code') {
                if (!checkCode(foundValueSet, obj)) {
                    if (property._valueSetStrength === 'required') {
                        this.addError(treeDisplay, 'Code "' + obj + '" not found in value set');
                    } else {
                        this.addWarn(treeDisplay, 'Code "' + obj + '" not found in value set');
                    }
                }
            }
        }
    }

    if (PRIMITIVE_TYPES.indexOf(property._type) >= 0) {
        if (property._type === 'boolean' && obj.toString().toLowerCase() !== 'true' && obj.toString().toLowerCase() !== 'false') {
            this.addError(treeDisplay, 'Invalid format for boolean value "' + obj.toString() + '"');
        } else if (PRIMITIVE_NUMBER_TYPES.indexOf(property._type) >= 0) {
            if (typeof(obj) === 'string') {
                if (property._type === 'integer' && !PRIMITIVE_INTEGER_REGEX.test(obj)) {
                    this.addError(treeDisplay, 'Invalid integer format for value "' + obj + '"');
                } else if (property._type === 'decimal' && !PRIMITIVE_DECIMAL_REGEX.test(obj)) {
                    this.addError(treeDisplay, 'Invalid decimal format for value "' + obj + '"');
                } else if (property._type === 'unsignedInt' && !PRIMITIVE_UNSIGNED_INT_REGEX.test(obj)) {
                    this.addError(treeDisplay, 'Invalid unsigned integer format for value "' + obj + '"');
                } else if (property._type === 'positiveInt' && !PRIMITIVE_POSITIVE_INT_REGEX.test(obj)) {
                    this.addError(treeDisplay, 'Invalid positive integer format for value "' + obj + '"');
                }
            }
        } else if (property._type === 'date' && !PRIMITIVE_DATE_REGEX.test(obj)) {
            this.addError(treeDisplay, 'Invalid date format for value "' + obj + '"');
        } else if (property._type === 'dateTime' && !PRIMITIVE_DATETIME_REGEX.test(obj)) {
            this.addError(treeDisplay, 'Invalid dateTime format for value "' + obj + '"');
        } else if (property._type === 'time' && !PRIMITIVE_TIME_REGEX.test(obj)) {
            this.addError(treeDisplay, 'Invalid time format for value "' + obj + '"');
        } else if (property._type === 'code' && !PRIMITIVE_CODE_REGEX.test(obj)) {
            this.addError(treeDisplay, 'Invalid code format for value "' + obj + '"');
        } else if (property._type === 'oid' && !PRIMITIVE_OID_REGEX.test(obj)) {
            this.addError(treeDisplay, 'Invalid oid format for value "' + obj + '"');
        } else if (property._type === 'id' && !PRIMITIVE_ID_REGEX.test(obj)) {
            this.addError(treeDisplay, 'Invalid id format for value "' + obj + '"');
        }
    } else if (property._type === 'Resource') {
        var typeDefinition = typeDefinitions[obj.resourceType];
        var nextValidationInstance = new FhirInstanceValidation(this.options, obj.id || getTreeDisplay(tree, this.isXml), this.isXml);

        if (!obj.resourceType || !typeDefinition) {
            nextValidationInstance.addFatal('', 'Resource does not have resourceType property, or value is not a valid resource type.');
        } else {
            nextValidationInstance.validateProperties(obj, typeDefinition._properties, [obj.resourceType]);
        }

        var nextValidationResponse = nextValidationInstance.getResponse();
        this.response.valid = !this.response.valid ? this.response.valid : nextValidationResponse.valid;
        this.response.messages = this.response.messages.concat(nextValidationResponse.messages);
    } else if (DATA_TYPES.indexOf(property._type) >= 0) {
        var typeDefinition = typeDefinitions[property._type];
        var nextValidationInstance = new FhirInstanceValidation(this.options, this.resourceId, this.isXml);
        nextValidationInstance.validateProperties(obj, typeDefinition._properties, tree);

        var nextValidationResponse = nextValidationInstance.getResponse();
        this.response.valid = !this.response.valid ? this.response.valid : nextValidationResponse.valid;
        this.response.messages = this.response.messages.concat(nextValidationResponse.messages);
    } else if (property._properties) {
        this.validateProperties(obj, property._properties, tree);
    }
};

FhirInstanceValidation.prototype.validateProperties = function(obj, properties, tree) {
    var _ = require('underscore');
    var self = this;

    for (var i = 0; i < properties.length; i++) {
        var property = properties[i];
        var foundProperty = obj.hasOwnProperty(property._name);
        var propertyValue = obj[property._name];

        // Look for missing properties
        if (property._required && !foundProperty) {
            var satisfied = false;

            if (property._choice) {
                satisfied = _.filter(properties, function(nextProperty) {
                        return nextProperty._choice === property._choice && !!obj[nextProperty._name];
                    }).length > 0;
            }

            if (!satisfied) {
                self.addError(getTreeDisplay(tree, self.isXml, property._choice ? property._choice : property._name), 'Missing property');
            }
        }

        // Only continue validating if we have a value for the property
        if (foundProperty) {
            // If this is an array/multiple, loop through each item in the array and validate it, instead of the array as a whole
            if (property._multiple) {
                if (propertyValue instanceof Array) {
                    if (property._required && propertyValue.length === 0) {
                        self.addError(getTreeDisplay(tree.concat([property._name])), 'A ' + property._name + ' entry is required');
                    }

                    for (var x = 0; x < propertyValue.length; x++) {
                        var foundPropertyElement = propertyValue[x];
                        var treeItem = property._name;

                        if (self.isXml) {
                            treeItem += '[' + (x + 1) + ']';
                        } else {
                            treeItem += '[' + x + ']';
                        }

                        self.validateNext(foundPropertyElement, property, tree.concat([treeItem]));
                    }
                } else {
                    self.addError(getTreeDisplay(tree.concat([property._name])), 'Property is not an array');
                }
            } else {
                self.validateNext(propertyValue, property, tree.concat([property._name]));
            }
        }
    };

    var objKeys = Object.keys(obj);
    for (var i = 0; i < objKeys.length; i++) {
        var objKey = objKeys[i];

        if (objKey === 'resourceType') {
            continue;
        }

        var foundProperty = _.find(properties, function(property) {
            return property._name === objKey;
        });

        if (!foundProperty) {
            if (self.options.errorOnUnexpected) {
                self.addError(getTreeDisplay(tree, self.isXml, objKey), 'Unexpected property');
            } else {
                self.addWarn(getTreeDisplay(tree, self.isXml, objKey), 'Unexpected property');
            }
        }
    };
};

var FhirValidation = function(options) {
    this.options = options || {};
};

FhirValidation.prototype.validate = function(obj, isXml) {
    var typeDefinition = typeDefinitions[obj.resourceType];
    var instanceValidation = new FhirInstanceValidation(this.options, obj.id || '#initial', isXml);

    if (!obj || !typeDefinition) {
        instanceValidation.addFatal('', 'Resource does not have resourceType property, or value is not a valid resource type.');
    } else {
        instanceValidation.validateProperties(obj, typeDefinition._properties, [obj.resourceType]);
    }

    return instanceValidation.getResponse();
};