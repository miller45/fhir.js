var xml2js = require('xml2js');
var Q = require('q');
var profiles = require('./profiles');

var Fhir = function(version) {
    var self = this;

    if (version == Fhir.DSTU2) {
        throw 'FHIR DSTU2 not implemented yet!';
    } else if (!version) {
        version = Fhir.DSTU1;
    }

    var XmlParser;
    var JsParser;

    if (version == Fhir.DSTU1) {
        XmlParser = require('./dstu1/xmlParser');
        JsParser = require('./dstu1/jsParser');
    }

    self.ObjectToXml = function(obj) {
        var jsParser = new JsParser(profiles);
        var xml = jsParser.CreateXml(obj);
        return xml;
    };

    self.JsonToXml = function(json) {
        var obj = JSON.parse(json);
        return self.ObjectToXml(obj);
    };

    self.XmlToJson = function(xmlString) {
        var deferred = Q.defer();

        self.XmlToObject(xmlString)
            .then(function(obj) {
                var json = JSON.stringify(obj);
                deferred.resolve(json);
            })
            .catch(function(err) {
                deferred.reject(err);
            });

        return deferred.promise;
    };

    self.XmlToObject = function(xmlString) {
        var deferred = Q.defer();

        var parser = new xml2js.Parser();

        try {
            parser.parseString(xmlString, function (err, result) {
                if (err) {
                    return deferred.reject(err);
                }

                var obj = {};
                var xmlParser = new XmlParser(profiles);

                for (var i in result) {
                    obj.resourceType = i;

                    if (obj.resourceType == 'atom:feed' || obj.resourceType == 'feed') {
                        delete obj.resourceType;
                        obj = xmlParser.PopulateBundle(obj, result[i]);
                    } else {
                        obj = xmlParser.PopulateFromXmlObject(obj, result[i], i);
                    }

                    break;
                }

                deferred.resolve(obj);
            });
        } catch (ex) {
            deferred.reject(ex);
        }

        return deferred.promise;
    };
};

Fhir.DSTU1 = '1';
Fhir.DSTU2 = '2';

module.exports = Fhir;